import { NextResponse } from 'next/server';
import scenarioData from '../../../config/scenario_hypoxia.json';

/**
 * Study AI — NCLEX-RN NGN Exam Readiness Evaluation Engine (v3.0 — Next.js Serverless Route)
 *
 * Exact 1:1 port of `backend-mock/main.py` (`POST /api/evaluate`) so the live Vercel deployment
 * works out-of-the-box with zero external backend configuration, while Oluwaseun can still point
 * `NEXT_PUBLIC_AI_BACKEND_URL` to his standalone Python FastAPI service (`http://localhost:8000/api/evaluate`).
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
]);

const ABC_CODES = new Set(['SET_BED_FOWLERS', 'ADMINISTER_O2', 'PAUSE_PCA']);

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
    service: 'Study AI NCLEX-RN NGN Evaluation Engine v3.0 (Next.js Serverless)',
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

    // ---------- Exit questions (answer keys live in the scenario JSON) ----------
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

    const endReason = payload.end_reason || 'STUDENT_CONCLUDED';
    const endedCodeBlue = endReason === 'CODE_BLUE_FAILURE';
    const firstIntervention = firstEvent(timeline, INTERVENTION_CODES);
    const blindEvents = timeline.filter((e) => e?.action === 'BLIND_INTERVENTION_PENALTY');

    // ---------- 1. KNOWLEDGE ----------
    let ev = firstEvent(timeline, 'POWER_ON_MONITOR');
    if (ev) {
      ledger.add(
        'knowledge',
        20,
        'Powered on bedside telemetry (SpO2 + ECG) to establish a baseline.',
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
      ledger.add('knowledge', 10, 'Documented the abnormal vital signs.', ev.step);
    }

    const tabPoints = { mar: 15, allergies: 15, notes: 10, labs: 5 };
    for (const [tab, pts] of Object.entries(tabPoints)) {
      const tabEv = timeline.find((e) => e?.action === 'REVIEW_EHR_TAB' && e?.tab === tab);
      if (tabEv) {
        ledger.add('knowledge', pts, `Reviewed EHR ${tab.toUpperCase()} tab.`, tabEv.step);
      } else {
        ledger.add('knowledge', 0, `Did not review the EHR ${tab.toUpperCase()} tab.`);
      }
    }

    if (abgCorrect) {
      ledger.add(
        'knowledge',
        25,
        'Correctly interpreted the ABG (uncompensated respiratory acidosis) and selected naloxone.'
      );
    } else {
      ledger.add(
        'knowledge',
        0,
        'Missed the ABG interpretation / pharmacology follow-up question.'
      );
    }

    // ---------- 2. PRIORITISATION ----------
    if (!firstIntervention) {
      ledger.add('prioritisation', 0, 'No airway/breathing or medication interventions were performed.');
    } else if (blindEvents.length === 0) {
      ledger.add(
        'prioritisation',
        25,
        'Completed admission safety checks (monitor, ID, MAR, allergies) before intervening.'
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
        15,
        "Elevated the head of bed (Fowler's) to support lung expansion.",
        ev.step
      );
      if ((room.bed_angle_deg || 0) >= 30) {
        ledger.add(
          'prioritisation',
          5,
          'Head of bed remained elevated at the end of the bedside phase.'
        );
      }
    } else {
      ledger.add('prioritisation', 0, 'Never elevated the head of bed.');
    }

    ev = firstEvent(timeline, 'ADMINISTER_O2');
    if (ev) {
      ledger.add('prioritisation', 15, 'Initiated supplemental oxygen per the PRN order.', ev.step);
      if (room.o2_device) {
        ledger.add(
          'prioritisation',
          5,
          'Supplemental oxygen remained in place at the end of the bedside phase.'
        );
      }
    } else {
      ledger.add('prioritisation', 0, 'Never applied supplemental oxygen.');
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
          `First ABC intervention within ${Math.round(delay)}s of recognizing the cues.`,
          firstAbc.step
        );
      } else if (delay <= 180) {
        ledger.add(
          'prioritisation',
          5,
          `First ABC intervention delayed (${Math.round(delay)}s after cues available).`,
          firstAbc.step
        );
      } else {
        ledger.add(
          'prioritisation',
          0,
          `First ABC intervention significantly delayed (${Math.round(delay)}s).`
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
        25,
        'Selected a complete, structured SBAR escalation with a specific recommendation.'
      );
    } else {
      ledger.add('prioritisation', 0, 'SBAR escalation was incomplete or unsafe.');
    }

    // ---------- 3. RISK RECOGNITION ----------
    ev = firstEvent(timeline, 'VERIFY_PATIENT_ID');
    if (ev) {
      ledger.add('risk_recognition', 15, 'Verified the wristband with two identifiers.', ev.step);
      if (!firstIntervention || (ev.step ?? 0) < (firstIntervention.step ?? 0)) {
        ledger.add('risk_recognition', 5, 'Patient identity confirmed before any intervention.');
      }
    } else {
      ledger.add('risk_recognition', 0, 'Never verified patient identity.');
    }

    ev = firstEvent(timeline, 'FLAG_ALLERGY');
    if (ev) {
      ledger.add('risk_recognition', 15, 'Flagged the penicillin anaphylaxis allergy.', ev.step);
    } else {
      ledger.add('risk_recognition', 0, 'Did not flag the penicillin anaphylaxis allergy.');
    }

    const pauseEv = firstEvent(timeline, 'PAUSE_PCA');
    if (room.pca_paused) {
      ledger.add(
        'risk_recognition',
        30,
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

    const crisis = firstEvent(timeline, OPIOID_CRISIS_CODES);
    if (crisis) {
      const reversal = timeline.find(
        (e) => e?.action === 'ADMINISTER_NALOXONE' && (e?.step ?? 0) > (crisis.step ?? 0)
      );
      if (reversal) {
        ledger.add(
          'risk_recognition',
          10,
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
      ledger.add('risk_recognition', 10, 'Prevented progression to opioid toxicity.');
    }

    const hadCritical = endedCodeBlue || actions.some((a) => CRITICAL_CODES.has(a));
    if (!hadCritical) {
      ledger.add('risk_recognition', 25, 'No critical safety events.');
    }

    const penaltyMap = {
      ALLERGY_CROSS_SENSITIVITY_ERROR: [
        -40,
        'Administered cefazolin despite penicillin anaphylaxis (cross-sensitivity risk).',
      ],
      OPIOID_DEMAND_BOLUS_TRAP: [
        -30,
        'Gave an additional opioid bolus to a patient with respiratory depression.',
      ],
      SALINE_FLUSH_TRAP: [-20, 'Rapid-flushed the PCA line, bolusing residual morphine.'],
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

    // ---------- 4. CLINICAL JUDGMENT ----------
    const endSpo2 = Number(room?.vitals?.spo2 || 0);
    if (payload.stabilized_at_end) {
      ledger.add(
        'clinical_judgment',
        35,
        'Patient met stabilization criteria at the end of the bedside phase (SpO2 ≥ 95%, RR ≥ 14, PCA paused).'
      );
    } else if (endSpo2 >= 90 && !endedCodeBlue) {
      ledger.add(
        'clinical_judgment',
        15,
        `Partial improvement (SpO2 ${endSpo2}%) but stabilization criteria not met.`
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

    ledger.add(
      'clinical_judgment',
      sbarCorrect ? 15 : 0,
      `SBAR escalation question ${sbarCorrect ? 'correct.' : 'incorrect.'}`
    );
    ledger.add(
      'clinical_judgment',
      abgCorrect ? 15 : 0,
      `ABG follow-up question ${abgCorrect ? 'correct.' : 'incorrect.'}`
    );

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

    // ---------- Missed critical actions ----------
    const missed = [];
    if (!sc.monitor_powered_on) missed.push('POWER_ON_BEDSIDE_MONITOR');
    if (!sc.wristband_verified) missed.push('VERIFY_PATIENT_WRISTBAND_ID');
    if (!sc.allergy_flagged) missed.push('FLAG_PENICILLIN_ANAPHYLAXIS_ALLERGY');
    if (!room.pca_paused) missed.push('PAUSE_MORPHINE_PCA_INFUSION');
    if (!room.o2_device) missed.push('APPLY_SUPPLEMENTAL_OXYGEN');
    if ((room.bed_angle_deg || 0) < 30) missed.push('ELEVATE_HEAD_OF_BED_FOWLERS');

    // ---------- NCJMM layers demonstrated ----------
    const layers = [];
    if (sc.monitor_powered_on) layers.push('RECOGNIZE_CUES');
    if (sc.mar_reviewed || sc.notes_reviewed) layers.push('ANALYZE_CUES');
    if (abgCorrect) layers.push('PRIORITIZE_HYPOTHESES');
    if (pauseEv || firstEvent(timeline, 'ADMINISTER_NALOXONE')) {
      layers.push('GENERATE_SOLUTIONS');
    }
    if (firstEvent(timeline, new Set(['SET_BED_FOWLERS', 'ADMINISTER_O2']))) {
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
    if (scores.risk_recognition < 80) {
      topics.push(
        'Opioid-induced respiratory depression: PCA safety, sedation scales & naloxone'
      );
    }
    if (actions.includes('ALLERGY_CROSS_SENSITIVITY_ERROR') || !sc.allergy_flagged) {
      topics.push('Penicillin–cephalosporin cross-sensitivity & allergy verification');
    }
    if (scores.prioritisation < 80) {
      topics.push('Maslow/ABC prioritisation & SBAR escalation');
    }
    if (!abgCorrect) {
      topics.push('ABG interpretation (respiratory acidosis)');
    }
    if (topics.length === 0) {
      topics.push(
        'Maintain readiness: practice a new NGN case type (e.g., transfusion reaction or sepsis)'
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

    // Adaptive follow-up question tailored to whether the candidate paused the PCA / avoided traps
    const adaptiveFollowupQuestion = !room.pca_paused
      ? {
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
        }
      : {
          question_id: 'adaptive_renarcotization_monitoring',
          ncsbn_category: 'Reduction of Risk Potential / Physiological Adaptation',
          prompt:
            'Thirty minutes after stabilizing the patient and pausing the Morphine PCA, why must the nurse continue close respiratory and sedation monitoring (Pasero Opioid-Induced Sedation Scale)?',
          options: [
            'Naloxone has a shorter biological half-life (30–90 min) than morphine, creating a risk of renarcotization and recurrent respiratory depression.',
            'Supplemental oxygen via Non-Rebreather permanently eliminates hypercapnia.',
            'Fowler’s position increases venous return to the right atrium and causes pulmonary edema.',
            'Cefazolin cross-reacts with opioid receptors after 30 minutes.',
          ],
          correct_option_index: 0,
          rationale:
            'Because naloxone is metabolized faster than most opioids, sedation and respiratory depression can recur ("renarcotization") once the antagonist wears off.',
        };

    return NextResponse.json({
      session_id: payload.session_id,
      scenario_id: payload.scenario_id,
      exam_mode: payload.exam_mode || 'NGN_EXAM_READINESS',
      evaluated_at: new Date().toISOString(),
      engine: 'Study AI NGN Evaluation Engine v3.0 (Next.js Serverless /api/evaluate)',
      overall_competency_score: overall,
      readiness_band: band,
      end_reason: endReason,
      end_reason_text: exam?.end_reasons?.[endReason] || endReason,
      time_used_sec: payload.total_scenario_time_sec ?? 0,
      time_limit_sec: payload.time_limit_sec ?? 300,
      stabilized_at_end: Boolean(payload.stabilized_at_end),
      critical_safety_events: criticalEvents,
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
