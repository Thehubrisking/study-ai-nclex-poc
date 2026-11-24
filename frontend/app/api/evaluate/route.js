import { NextResponse } from 'next/server';
import scenarioData from '../../../config/scenario_hypoxia.json';

/**
 * Study AI — NCLEX-RN NGN Exam Readiness Evaluation Engine (v3.1 — Next.js Serverless Route)
 *
 * Exact 1:1 port of `backend-mock/main.py` (`POST /api/evaluate`) scoring the post-exploratory
 * laparotomy dual-complication scenario (Opioid Respiratory Depression + Postoperative Hemorrhage
 * / Wound Dehiscence-Evisceration Risk) into StudyAI's 4 diagnostic domains (0-100 each).
 */

const DOMAINS = ['knowledge', 'prioritisation', 'risk_recognition', 'clinical_judgment'];

const NCSBN_DOMAINS = {
  knowledge: 'Physiological Adaptation (11-17%)',
  prioritisation: 'Management of Care (15-21%)',
  risk_recognition:
    'Safety & Infection Control (10-16%) / Pharmacological & Parenteral Therapies (13-19%)',
  clinical_judgment: 'NCJMM 6-Layer Synthesis • Reduction of Risk Potential (9-15%)',
};

const TRAP_CODES = new Set([
  'TRENDELENBURG_TRAP',
  'OPIOID_DEMAND_BOLUS_TRAP',
  'SALINE_FLUSH_TRAP',
  'CONTINUE_BASAL_TRAP',
  'ALLERGY_CROSS_SENSITIVITY_ERROR',
  'REMOVE_PRIMARY_DRESSING_TRAP',
  'LEAVE_JP_OPEN_TRAP',
]);

const CRITICAL_CODES = new Set([
  'ALLERGY_CROSS_SENSITIVITY_ERROR',
  'OPIOID_DEMAND_BOLUS_TRAP',
]);

const INTERVENTION_CODES = new Set([
  'ADMINISTER_O2',
  'PAUSE_PCA',
  'OPIOID_DEMAND_BOLUS_TRAP',
  'CONTINUE_BASAL_TRAP',
  'SALINE_FLUSH_TRAP',
  'PREPARE_NALOXONE',
  'ADMINISTER_NALOXONE',
  'NALOXONE_NOT_INDICATED',
  'ALLERGY_CROSS_SENSITIVITY_ERROR',
  'CEFAZOLIN_HELD_ALLERGY',
  'INITIATE_CRYSTALLOID_BOLUS',
  'REMOVE_PRIMARY_DRESSING_TRAP',
  'LEAVE_JP_OPEN_TRAP',
]);

const ABC_CODES = new Set([
  'SET_BED_FOWLERS',
  'ADMINISTER_O2',
  'PAUSE_PCA',
  'INITIATE_CRYSTALLOID_BOLUS',
]);

const OPIOID_CRISIS_CODES = new Set([
  'OPIOID_DEMAND_BOLUS_TRAP',
  'SALINE_FLUSH_TRAP',
  'OPIOID_MASKING_BRADYPNEA',
  'RENARCOTIZATION',
]);

class DomainLedger {
  constructor() {
    this.points = Object.fromEntries(DOMAINS.map((d) => [d, 0]));
    this.findings = Object.fromEntries(DOMAINS.map((d) => [d, []]));
    this.stepImpacts = {};
  }

  add(domain, pts, finding, step = null) {
    this.points[domain] += pts;
    this.findings[domain].push({ points: pts, text: finding });
    if (step !== null && step !== undefined && pts !== 0) {
      const label = domain
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      if (!this.stepImpacts[step]) this.stepImpacts[step] = [];
      this.stepImpacts[step].push(`${pts > 0 ? `+${pts}` : pts} ${label}`);
    }
  }

  score(domain) {
    return Math.max(0, Math.min(100, Math.round(this.points[domain])));
  }
}

function firstEvent(timeline, codes) {
  const codeSet = typeof codes === 'string' ? new Set([codes]) : codes;
  return timeline.find((e) => codeSet.has(e?.action)) || null;
}

function domainStatus(score, domain) {
  if (score >= 80) return 'STRONG';
  if (score >= 60) return 'DEVELOPING';
  return domain === 'risk_recognition' ? 'GAP_IDENTIFIED' : 'NEEDS_PRACTICE';
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Study AI NCLEX-RN NGN Evaluation Engine v3.1 (Next.js Serverless)',
  });
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const exam = scenarioData?.exam_config || {};
    const rawTimeline = Array.isArray(payload.action_timeline) ? payload.action_timeline : [];
    const timeline = [...rawTimeline].sort((a, b) => (a?.step ?? 0) - (b?.step ?? 0));
    const sc = payload.safety_checks || {};
    const room = payload.final_room_state || {};
    const actions = timeline.map((e) => e?.action);
    const ledger = new DomainLedger();

    // ---------- In-Station Micro-Questions (answer keys live in scenario JSON) ----------
    const sqResponses = {};
    for (const r of payload.station_question_responses || []) {
      if (r?.question_id) sqResponses[r.question_id] = r.selected_option_id ?? null;
    }

    const stationQuestionResults = [];
    const sqCorrect = {};
    for (const [stationId, sq] of Object.entries(exam.station_questions || {})) {
      const selected = sqResponses[sq.question_id] ?? null;
      const correct = selected === sq.correct_option_id;
      sqCorrect[sq.question_id] = correct;
      const optionText = Object.fromEntries((sq.options || []).map((o) => [o.id, o.text]));
      stationQuestionResults.push({
        question_id: sq.question_id,
        station_id: stationId,
        station_label: exam?.station_labels?.[stationId] || stationId,
        ncsbn_category: sq.ncsbn_category,
        prompt: sq.prompt,
        selected_option_id: selected,
        selected_option_text: selected ? optionText[selected] || null : null,
        correct_option_id: sq.correct_option_id,
        correct_option_text: optionText[sq.correct_option_id] || null,
        is_correct: correct,
        rationale: sq.rationale,
      });
    }

    // ---------- Exit Questions (4 post-laparotomy NCLEX questions) ----------
    const responses = {};
    for (const r of payload.exit_question_responses || []) {
      if (r?.question_id) responses[r.question_id] = r.selected_option_id ?? null;
    }

    const questionResults = [];
    const qCorrect = {};
    for (const q of exam.exit_questions || []) {
      const selected = responses[q.question_id] ?? null;
      const correct = selected === q.correct_option_id;
      qCorrect[q.question_id] = correct;
      const optionText = Object.fromEntries((q.options || []).map((o) => [o.id, o.text]));
      questionResults.push({
        question_id: q.question_id,
        title: q.title,
        ncsbn_category: q.ncsbn_category,
        prompt: q.prompt,
        selected_option_id: selected,
        selected_option_text: selected ? optionText[selected] || null : null,
        correct_option_id: q.correct_option_id,
        correct_option_text: optionText[q.correct_option_id] || null,
        is_correct: correct,
        rationale: q.rationale,
      });
    }

    const sbarCorrect = Boolean(qCorrect.q1_sbar);
    const abgCorrect = Boolean(qCorrect.q2_abg);
    const hemorrhageQCorrect = Boolean(qCorrect.q3_hemorrhage_jp);

    const endReason = payload.end_reason || 'STUDENT_CONCLUDED';
    const endedCodeBlue = endReason === 'CODE_BLUE_FAILURE';
    const firstIntervention = firstEvent(timeline, INTERVENTION_CODES);
    const blindEvents = timeline.filter((e) => e?.action === 'BLIND_INTERVENTION_PENALTY');

    // ---------- 1. KNOWLEDGE (Max 100) ----------
    let ev = firstEvent(timeline, 'POWER_ON_MONITOR');
    if (ev) {
      ledger.add(
        'knowledge',
        15,
        'Powered on bedside telemetry (SpO2, HR, BP, RR, EtCO2) to establish an objective baseline.',
        ev.step
      );
    } else {
      ledger.add(
        'knowledge',
        0,
        'Never powered on the bedside monitor — no objective vital-sign baseline.'
      );
    }

    ev = firstEvent(timeline, 'DOCUMENT_VITALS');
    if (ev) {
      ledger.add('knowledge', 5, 'Documented the abnormal post-laparotomy vital signs.', ev.step);
    }

    const tabPoints = { mar: 10, allergies: 10, notes: 10, labs: 10 };
    for (const [tab, pts] of Object.entries(tabPoints)) {
      const tabEv = timeline.find((e) => e?.action === 'REVIEW_EHR_TAB' && e?.tab === tab);
      if (tabEv) {
        ledger.add('knowledge', pts, `Reviewed EHR ${tab.toUpperCase()} tab.`, tabEv.step);
      } else {
        ledger.add('knowledge', 0, `Did not review the EHR ${tab.toUpperCase()} tab.`);
      }
    }

    ev = firstEvent(timeline, 'VERIFY_GTUBE');
    if (ev || sc.gtube_verified || room.gtube_verified) {
      ledger.add(
        'knowledge',
        5,
        'Verified left-upper-quadrant gastrostomy (G-tube) wafer seal and bilious decompression return.',
        ev ? ev.step : null
      );
    } else {
      ledger.add('knowledge', 0, 'Did not verify gastrostomy (G-tube) site integrity.');
    }

    for (const sqRes of stationQuestionResults) {
      if (sqRes.is_correct) {
        ledger.add(
          'knowledge',
          5,
          `Answered ${sqRes.station_label} clinical cue check (${sqRes.question_id}) correctly.`
        );
      } else {
        ledger.add(
          'knowledge',
          0,
          `Missed or skipped ${sqRes.station_label} clinical cue check (${sqRes.question_id}).`
        );
      }
    }

    if (abgCorrect) {
      ledger.add(
        'knowledge',
        20,
        'Correctly interpreted the ABG (uncompensated respiratory acidosis) and selected naloxone.'
      );
    } else {
      ledger.add(
        'knowledge',
        0,
        'Missed the ABG interpretation / opioid reversal exit question.'
      );
    }

    // ---------- 2. PRIORITISATION (Max 100) ----------
    if (!firstIntervention) {
      ledger.add('prioritisation', 0, 'No airway, hemodynamic, or medication interventions were performed.');
    } else if (blindEvents.length === 0) {
      ledger.add(
        'prioritisation',
        20,
        'Completed admission safety checks (monitor, ID, side rails, MAR, allergies) before intervening.'
      );
    } else {
      ledger.add(
        'prioritisation',
        0,
        `Intervened before completing admission safety checks (${blindEvents.length} blind intervention(s)).`
      );
    }

    ev = firstEvent(timeline, 'SET_BED_FOWLERS');
    if (ev) {
      ledger.add(
        'prioritisation',
        12,
        "Elevated the head of bed (Semi/High Fowler's) to support diaphragmatic excursion.",
        ev.step
      );
      if ((room.bed_angle_deg || 0) >= 30) {
        ledger.add(
          'prioritisation',
          3,
          'Head of bed remained elevated at the end of the bedside phase.'
        );
      }
    } else {
      ledger.add('prioritisation', 0, 'Never elevated the head of bed.');
    }

    ev = firstEvent(timeline, 'ADMINISTER_O2');
    if (ev) {
      ledger.add('prioritisation', 12, 'Initiated supplemental oxygen per the PRN order.', ev.step);
      if (room.o2_device) {
        ledger.add(
          'prioritisation',
          3,
          'Supplemental oxygen remained in place at the end of the bedside phase.'
        );
      }
    } else {
      ledger.add('prioritisation', 0, 'Never applied supplemental oxygen.');
    }

    ev = firstEvent(timeline, 'INITIATE_CRYSTALLOID_BOLUS');
    if (ev || room.crystalloid_bolus) {
      ledger.add(
        'prioritisation',
        10,
        'Initiated PRN 0.9% Normal Saline 500 mL IV bolus via secondary port for hemorrhagic hypotension.',
        ev ? ev.step : null
      );
    } else {
      ledger.add(
        'prioritisation',
        0,
        'Did not initiate the PRN 0.9% Normal Saline IV bolus despite hypotension (BP 92/58) and tachycardia.'
      );
    }

    const firstAbc = firstEvent(timeline, ABC_CODES);
    const monitorEv = firstEvent(timeline, 'POWER_ON_MONITOR');
    if (firstAbc) {
      const refT = monitorEv ? Number(monitorEv.timestamp_sec || 0) : 0;
      const delay = Math.max(0, Number(firstAbc.timestamp_sec || 0) - refT);
      if (delay <= 90) {
        ledger.add(
          'prioritisation',
          10,
          `First ABC/hemodynamic intervention within ${Math.round(delay)}s of recognizing the cues.`,
          firstAbc.step
        );
      } else if (delay <= 180) {
        ledger.add(
          'prioritisation',
          5,
          `First ABC/hemodynamic intervention delayed (${Math.round(delay)}s after cues available).`,
          firstAbc.step
        );
      } else {
        ledger.add(
          'prioritisation',
          0,
          `First ABC/hemodynamic intervention significantly delayed (${Math.round(delay)}s).`
        );
      }
    }

    for (const e of timeline) {
      if (e?.action === 'TRENDELENBURG_TRAP') {
        ledger.add(
          'prioritisation',
          -20,
          'Placed the patient in Trendelenburg, worsening diaphragmatic excursion.',
          e.step
        );
      }
    }

    if (sbarCorrect) {
      ledger.add(
        'prioritisation',
        15,
        'Selected a complete SBAR surgical escalation covering both opioid depression and active JP hemorrhage.'
      );
    } else {
      ledger.add('prioritisation', 0, 'SBAR surgical escalation was incomplete or unsafe.');
    }

    if (hemorrhageQCorrect) {
      ledger.add(
        'prioritisation',
        15,
        'Correctly identified the postoperative hemorrhage & JP drain shock triad requiring STAT surgical escalation.'
      );
    } else {
      ledger.add('prioritisation', 0, 'Missed the postoperative hemorrhage & JP drain recognition exit question.');
    }

    // ---------- 3. RISK RECOGNITION (Max 100) ----------
    ev = firstEvent(timeline, 'VERIFY_PATIENT_ID');
    if (ev) {
      ledger.add('risk_recognition', 10, 'Verified the wristband with two identifiers.', ev.step);
      if (!firstIntervention || (ev.step ?? 0) < (firstIntervention.step ?? 0)) {
        ledger.add('risk_recognition', 5, 'Patient identity confirmed before any intervention.');
      }
    } else {
      ledger.add('risk_recognition', 0, 'Never verified patient identity.');
    }

    ev = firstEvent(timeline, 'RAISE_SIDE_RAILS');
    const partialRailEv = firstEvent(timeline, 'RAISE_SIDE_RAIL_PARTIAL');
    if (sc.side_rails_raised || room.side_rails_up) {
      ledger.add(
        'risk_recognition',
        10,
        'Visually observed lowered bed rails and raised & locked both bedside safety rails.',
        ev ? ev.step : partialRailEv ? partialRailEv.step : null
      );
    } else if ((sc.rails_raised_count || 0) === 1 || room.left_rail_up || room.right_rail_up) {
      ledger.add(
        'risk_recognition',
        5,
        'Raised 1 of 2 bedside safety rails; opposite side rail remained lowered.',
        partialRailEv ? partialRailEv.step : null
      );
    } else {
      ledger.add(
        'risk_recognition',
        0,
        'Left both bedside safety rails lowered despite opioid sedation and hypotension (fall hazard).'
      );
    }

    ev = firstEvent(timeline, 'FLAG_ALLERGY');
    if (ev) {
      ledger.add('risk_recognition', 10, 'Flagged the penicillin anaphylaxis allergy.', ev.step);
    } else {
      ledger.add('risk_recognition', 0, 'Did not flag the penicillin anaphylaxis allergy.');
    }

    const pauseEv = firstEvent(timeline, 'PAUSE_PCA');
    if (room.pca_paused) {
      ledger.add(
        'risk_recognition',
        25,
        'Morphine PCA was paused (opioid source controlled).',
        pauseEv ? pauseEv.step : null
      );
    } else if (pauseEv) {
      ledger.add(
        'risk_recognition',
        10,
        'Paused the morphine PCA but it was later resumed.',
        pauseEv.step
      );
    } else {
      ledger.add(
        'risk_recognition',
        0,
        'Morphine PCA was never paused despite respiratory depression cues.'
      );
    }

    const jpEv = firstEvent(timeline, 'ASSESS_JP_HEMORRHAGE');
    if (room.jp_assessed || sc.jp_hemorrhage_assessed || jpEv) {
      ledger.add(
        'risk_recognition',
        15,
        'Measured 135 mL/hr sanguineous JP drain output, re-compressed the bulb for suction, reinforced strikethrough gauze, and flagged hemorrhage.',
        jpEv ? jpEv.step : null
      );
    } else {
      ledger.add(
        'risk_recognition',
        0,
        'Never assessed the blood-saturated laparotomy dressing or 135 mL/hr sanguineous JP bulb drain.'
      );
    }

    const crisis = firstEvent(timeline, OPIOID_CRISIS_CODES);
    if (crisis) {
      const reversal = timeline.find(
        (e) => e?.action === 'ADMINISTER_NALOXONE' && (e?.step ?? 0) > (crisis.step ?? 0)
      );
      if (reversal) {
        ledger.add(
          'risk_recognition',
          5,
          'Recognized opioid toxicity and administered naloxone.',
          reversal.step
        );
      } else {
        ledger.add(
          'risk_recognition',
          0,
          'Opioid toxicity developed but naloxone was not administered.'
        );
      }
    } else {
      ledger.add('risk_recognition', 5, 'Prevented progression to acute opioid toxicity.');
    }

    if (!actions.includes('UNRECOGNIZED_HEMORRHAGE_ESCALATION') && !room.hemorrhage_shock) {
      ledger.add(
        'risk_recognition',
        5,
        'Addressed surgical bleeding / hemodynamics before progression to decompensated hypovolemic shock.'
      );
    } else {
      ledger.add(
        'risk_recognition',
        0,
        'Unaddressed surgical bleeding progressed to worsening hypovolemic shock (HR 136, BP 78/46).'
      );
    }

    const hadCritical = endedCodeBlue || actions.some((a) => CRITICAL_CODES.has(a));
    if (!hadCritical) {
      ledger.add('risk_recognition', 15, 'No critical safety events.');
    }

    const penaltyMap = {
      ALLERGY_CROSS_SENSITIVITY_ERROR: [
        -40,
        'Administered cefazolin despite penicillin anaphylaxis (cross-sensitivity risk).',
      ],
      OPIOID_DEMAND_BOLUS_TRAP: [
        -30,
        'Gave an additional opioid bolus to a patient with respiratory depression and hypotension.',
      ],
      SALINE_FLUSH_TRAP: [-20, 'Rapid-flushed the PCA line, bolusing residual morphine.'],
      REMOVE_PRIMARY_DRESSING_TRAP: [
        -20,
        "Peeled off the surgeon's primary laparotomy dressing (<24 hr post-op), disrupting hemostatic clots.",
      ],
      LEAVE_JP_OPEN_TRAP: [
        -15,
        'Left the JP bulb uncompressed and open to air, eliminating closed suction and creating an infection portal.',
      ],
      CONTINUE_BASAL_TRAP: [-15, 'Chose to continue the basal morphine infusion.'],
    };

    for (const e of timeline) {
      if (e?.action && penaltyMap[e.action]) {
        const [pts, text] = penaltyMap[e.action];
        ledger.add('risk_recognition', pts, text, e.step);
      }
    }

    let blindTotal = 0;
    for (const e of blindEvents) {
      if (blindTotal <= -20) break;
      ledger.add('risk_recognition', -5, `Blind intervention: ${e?.detail || ''}`, e.step);
      blindTotal -= 5;
    }

    // ---------- 4. CLINICAL JUDGMENT (Max 100) ----------
    const endSpo2 = Number(room?.vitals?.spo2 || 0);
    if (payload.stabilized_at_end) {
      ledger.add(
        'clinical_judgment',
        35,
        'Patient met full stabilization criteria (SpO2 ≥ 95%, RR ≥ 14, PCA paused, JP surgical hemorrhage assessed).'
      );
    } else if (endSpo2 >= 90 && !endedCodeBlue) {
      ledger.add(
        'clinical_judgment',
        15,
        `Partial improvement (SpO2 ${endSpo2}%) but full respiratory + surgical stabilization criteria were not met.`
      );
    } else {
      ledger.add('clinical_judgment', 0, `Patient was not stabilized (final SpO2 ${endSpo2}%).`);
    }

    if (endReason === 'STUDENT_CONCLUDED') {
      ledger.add(
        'clinical_judgment',
        10,
        'Concluded bedside care and escalated within the time limit.'
      );
    } else if (endReason === 'TIME_EXPIRED') {
      ledger.add('clinical_judgment', 0, 'Did not escalate before the time limit expired.');
    }

    for (const qRes of questionResults) {
      ledger.add(
        'clinical_judgment',
        qRes.is_correct ? 5 : 0,
        `${qRes.title}: ${qRes.is_correct ? 'correct.' : 'incorrect.'}`
      );
    }

    for (const sqRes of stationQuestionResults) {
      ledger.add(
        'clinical_judgment',
        sqRes.is_correct ? 5 : 0,
        `In-station NCLEX synthesis (${sqRes.station_label}): ${sqRes.is_correct ? 'correct.' : 'incorrect.'}`
      );
    }

    const trapCount = actions.filter((a) => TRAP_CODES.has(a)).length;
    ledger.add(
      'clinical_judgment',
      Math.max(0, 25 - 10 * trapCount),
      trapCount === 0
        ? 'Distractor avoidance: no clinical distractors selected (full credit).'
        : `Distractor avoidance: ${trapCount} clinical distractor(s) selected (partial credit, -10 each from 25).`
    );

    if (endedCodeBlue) {
      const excess = ledger.points.clinical_judgment - 25;
      if (excess > 0) {
        ledger.add(
          'clinical_judgment',
          -excess,
          'Code Blue failure caps clinical judgment at 25.'
        );
      }
    }

    const scores = Object.fromEntries(DOMAINS.map((d) => [d, ledger.score(d)]));
    const overall = Math.round(
      Object.values(scores).reduce((sum, v) => sum + v, 0) / DOMAINS.length
    );

    // ---------- Readiness band ----------
    const criticalEvents = [];
    if (endedCodeBlue) criticalEvents.push('CODE_BLUE_FAILURE');
    for (const a of actions) {
      if (CRITICAL_CODES.has(a)) criticalEvents.push(a);
    }

    let band;
    if (criticalEvents.length > 0) {
      band = {
        level: 'BELOW_STANDARD',
        label: 'BELOW PASSING STANDARD — CRITICAL SAFETY EVENT',
        detail:
          'A critical patient-safety event occurred. On the NGN exam, unsafe actions outweigh otherwise strong performance.',
      };
    } else if (overall >= 80) {
      band = {
        level: 'HIGH',
        label: 'HIGH LIKELIHOOD OF PASSING',
        detail: 'Performance is consistently above the passing standard.',
      };
    } else if (overall >= 65) {
      band = {
        level: 'NEAR',
        label: 'NEAR PASSING STANDARD',
        detail: 'Performance is close to the passing standard; targeted review recommended.',
      };
    } else {
      band = {
        level: 'BELOW_STANDARD',
        label: 'BELOW PASSING STANDARD',
        detail: 'Significant gaps in clinical judgment for this case type.',
      };
    }

    // ---------- Missed critical actions (8 bedside safety & priority actions) ----------
    const totalCriticalActions = 8;
    const missed = [];
    if (!sc.monitor_powered_on) missed.push('POWER_ON_BEDSIDE_MONITOR');
    if (!sc.wristband_verified) missed.push('VERIFY_PATIENT_WRISTBAND_ID');
    if (!sc.side_rails_raised && !room.side_rails_up) missed.push('RAISE_BED_SIDE_RAILS');
    if (!sc.allergy_flagged) missed.push('FLAG_PENICILLIN_ANAPHYLAXIS_ALLERGY');
    if (!room.pca_paused) missed.push('PAUSE_MORPHINE_PCA_INFUSION');
    if (!room.o2_device) missed.push('APPLY_SUPPLEMENTAL_OXYGEN');
    if ((room.bed_angle_deg || 0) < 30) missed.push('ELEVATE_HEAD_OF_BED_FOWLERS');
    if (!room.jp_assessed && !sc.jp_hemorrhage_assessed) {
      missed.push('ASSESS_JP_SURGICAL_DRAIN_HEMORRHAGE');
    }

    // ---------- NCJMM layers demonstrated ----------
    const layers = [];
    if (sc.monitor_powered_on) layers.push('RECOGNIZE_CUES');
    if (sc.mar_reviewed || sc.notes_reviewed || sc.labs_reviewed) layers.push('ANALYZE_CUES');
    if (abgCorrect || hemorrhageQCorrect) layers.push('PRIORITIZE_HYPOTHESES');
    if (
      pauseEv ||
      firstEvent(timeline, 'ADMINISTER_NALOXONE') ||
      firstEvent(timeline, 'ASSESS_JP_HEMORRHAGE')
    ) {
      layers.push('GENERATE_SOLUTIONS');
    }
    if (
      firstEvent(
        timeline,
        new Set(['SET_BED_FOWLERS', 'ADMINISTER_O2', 'INITIATE_CRYSTALLOID_BOLUS'])
      )
    ) {
      layers.push('TAKE_ACTION');
    }
    const reassessed =
      firstAbc !== null &&
      timeline.some(
        (e) => e?.action === 'DOCUMENT_VITALS' && (e?.step ?? 0) > (firstAbc.step ?? 0)
      );
    if (reassessed || (payload.stabilized_at_end && endReason === 'STUDENT_CONCLUDED')) {
      layers.push('EVALUATE_OUTCOMES');
    }

    const topics = [];
    if (
      !room.jp_assessed ||
      !hemorrhageQCorrect ||
      sqCorrect.sq_surgical_wound === false ||
      actions.includes('REMOVE_PRIMARY_DRESSING_TRAP') ||
      actions.includes('LEAVE_JP_OPEN_TRAP')
    ) {
      topics.push(
        'Postoperative hemorrhage: Jackson-Pratt (JP) bulb closed suction, dressing reinforcement (<24 hr post-op) & hypovolemic shock cues'
      );
    }
    if (scores.risk_recognition < 80 || !room.pca_paused) {
      topics.push(
        'Opioid-induced respiratory depression: PCA safety, fall precautions (side rails) & naloxone'
      );
    }
    if (actions.includes('ALLERGY_CROSS_SENSITIVITY_ERROR') || !sc.allergy_flagged) {
      topics.push('Penicillin–cephalosporin cross-sensitivity & allergy verification');
    }
    if (scores.prioritisation < 80) {
      topics.push('Maslow/ABC prioritisation, isotonic fluid resuscitation & SBAR surgical escalation');
    }
    if (!abgCorrect) {
      topics.push('ABG interpretation (uncompensated respiratory acidosis)');
    }
    if (topics.length === 0) {
      topics.push(
        'Maintain readiness: practice a new NGN case type (e.g., acute blood transfusion reaction or septic shock)'
      );
    }

    // ---------- Decision tree ----------
    const decisionTree = timeline.map((e) => ({
      step: e?.step,
      timestamp_sec: e?.timestamp_sec,
      action: e?.action,
      label: e?.label || e?.action,
      detail: e?.detail,
      station: e?.station_label,
      classification: e?.classification || 'NEUTRAL',
      severity: e?.severity,
      rationale: e?.rationale,
      vitals_snapshot: e?.vitals_snapshot,
      score_impact: ledger.stepImpacts[e?.step] || [],
    }));

    const traps = decisionTree.filter((d) =>
      ['TRAP', 'CRITICAL_ERROR', 'PENALTY'].includes(d.classification)
    );

    let adaptiveFollowupQuestion;
    if (!room.jp_assessed || actions.includes('REMOVE_PRIMARY_DRESSING_TRAP')) {
      adaptiveFollowupQuestion = {
        question_id: 'adaptive_jp_drain_suction',
        ncsbn_category: 'Reduction of Risk Potential',
        prompt:
          'When emptying and resetting a Jackson-Pratt (JP) closed-wound suction drain that contains 135 mL of bright-red sanguineous fluid, how must the nurse re-establish negative-pressure suction and manage the saturated primary laparotomy gauze (<24 hr post-op)?',
        options: [
          'Open the pouring spout, measure drainage in a calibrated cup, fully compress the bulb flat with your hand BEFORE recapping the plug, and reinforce OVER the primary surgical gauze with sterile abdominal pads while notifying the surgeon STAT.',
          'Recap the pouring spout while the bulb is fully inflated so positive air pressure tamponades the surgical bed, and peel off the bloody primary gauze.',
          'Connect the Jackson-Pratt tubing directly to high continuous wall suction (-200 mmHg).',
          'Leave the JP drain plug uncapped to gravity drainage and irrigate the surgical drain lumen with tap water.',
        ],
        correct_option_index: 0,
        rationale:
          'Compressing the JP bulb flat before sealing the plug creates gentle negative suction; within the first 24 hours post-laparotomy, blood-soaked primary dressings are reinforced (never peeled off) to avoid dislodging clots while escalating to surgery.',
      };
    } else if (!room.pca_paused) {
      adaptiveFollowupQuestion = {
        question_id: 'adaptive_opioid_antagonist',
        ncsbn_category: 'Pharmacological and Parenteral Therapies',
        prompt:
          'Because the Morphine PCA continued infusing, the patient progresses to severe respiratory depression (RR 6/min, SpO2 78%, EtCO2 64 mmHg). Which PRN medication and nursing action is immediately indicated?',
        options: [
          'Administer Naloxone (Narcan) 0.4 mg IV push slowly and stop the Morphine PCA infusion.',
          'Administer Flumazenil 0.2 mg IV push over 15 seconds.',
          'Flush the peripheral IV line with 10 mL of 0.9% Normal Saline.',
          'Decrease the Morphine PCA basal rate from 2 mg/hr to 1 mg/hr.',
        ],
        correct_option_index: 0,
        rationale:
          'Naloxone is a competitive mu-opioid receptor antagonist that reverses opioid-induced respiratory depression; stopping the PCA prevents ongoing opioid delivery.',
      };
    } else {
      adaptiveFollowupQuestion = {
        question_id: 'adaptive_renarcotization_monitoring',
        ncsbn_category: 'Reduction of Risk Potential / Physiological Adaptation',
        prompt:
          'Thirty minutes after stabilizing the patient and pausing the Morphine PCA, why must the nurse continue close respiratory, sedation (Pasero scale), and JP drain output monitoring?',
        options: [
          'Naloxone has a shorter half-life (30–90 min) than morphine (risk of renarcotization), and crystalloid resuscitation raising blood pressure can unmask ongoing surgical-bed bleeding.',
          'Supplemental oxygen via Non-Rebreather permanently eliminates hypercapnia.',
          "Semi-Fowler's position causes rapid gastrostomy tube dislodgement.",
          'Cefazolin cross-reacts with opioid receptors after 30 minutes.',
        ],
        correct_option_index: 0,
        rationale:
          'Naloxone wears off faster than morphine ("renarcotization"), and restoring arterial pressure with IV crystalloids can increase bleeding from an unligated mesenteric vessel — requiring serial vital sign and JP output surveillance.',
      };
    }

    return NextResponse.json({
      session_id: payload.session_id,
      student_id: payload.student_id || 'anonymous',
      scenario_id: payload.scenario_id,
      exam_mode: payload.exam_mode || 'NGN_EXAM_READINESS',
      evaluated_at: new Date().toISOString(),
      engine: 'Study AI NGN Evaluation Engine v3.1 (Next.js Serverless /api/evaluate)',
      overall_competency_score: overall,
      readiness_band: band,
      end_reason: endReason,
      end_reason_text: exam?.end_reasons?.[endReason] || endReason,
      time_used_sec: payload.total_scenario_time_sec ?? 0,
      time_limit_sec: payload.time_limit_sec ?? 300,
      stabilized_at_end: Boolean(payload.stabilized_at_end),
      critical_safety_events: criticalEvents,
      total_critical_actions: totalCriticalActions,
      diagnostic_breakdown: Object.fromEntries(
        DOMAINS.map((d) => [
          d,
          {
            score: scores[d],
            ncsbn_domain: NCSBN_DOMAINS[d],
            status: domainStatus(scores[d], d),
            findings: ledger.findings[d],
          },
        ])
      ),
      ncjmm_layers_demonstrated: layers,
      missed_critical_actions: missed,
      recommended_practice_topics: topics,
      station_questions: stationQuestionResults,
      exit_questions: questionResults,
      adaptive_followup_question: adaptiveFollowupQuestion,
      decision_tree: decisionTree,
      traps_triggered: traps,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Invalid telemetry payload',
        detail: err?.message || String(err),
      },
      { status: 400 }
    );
  }
}
