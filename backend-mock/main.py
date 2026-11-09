"""
Study AI — NCLEX-RN NGN Exam Readiness Evaluation Engine (v3.0)

Scores a strict, timed bedside attempt into Study AI's 4 mandatory diagnostic domains
(knowledge, prioritisation, risk_recognition, clinical_judgment).

Clinical content (exit-question answer keys, rationales, event labels) is read from the shared
scenario file `frontend/config/scenario_hypoxia.json` on every request, so the Clinical Lead can
edit it without touching this code or restarting the server.
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="Study AI NCLEX-RN Diagnostic Telemetry & Evaluation Engine",
    version="3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SCENARIO_PATH = (
    Path(__file__).resolve().parent.parent / "frontend" / "config" / "scenario_hypoxia.json"
)

DOMAINS = ["knowledge", "prioritisation", "risk_recognition", "clinical_judgment"]
NCSBN_DOMAINS = {
    "knowledge": "Physiological Adaptation (11-17%)",
    "prioritisation": "Management of Care (15-21%)",
    "risk_recognition": "Safety & Infection Control (10-16%) / Pharmacological & Parenteral Therapies (13-19%)",
    "clinical_judgment": "NCJMM 6-Layer Synthesis • Reduction of Risk Potential (9-15%)",
}

TRAP_CODES = {
    "TRENDELENBURG_TRAP",
    "OPIOID_DEMAND_BOLUS_TRAP",
    "SALINE_FLUSH_TRAP",
    "CONTINUE_BASAL_TRAP",
    "ALLERGY_CROSS_SENSITIVITY_ERROR",
}
CRITICAL_CODES = {"ALLERGY_CROSS_SENSITIVITY_ERROR", "OPIOID_DEMAND_BOLUS_TRAP"}
INTERVENTION_CODES = {
    "ADMINISTER_O2",
    "PAUSE_PCA",
    "OPIOID_DEMAND_BOLUS_TRAP",
    "CONTINUE_BASAL_TRAP",
    "SALINE_FLUSH_TRAP",
    "PREPARE_NALOXONE",
    "ADMINISTER_NALOXONE",
    "NALOXONE_NOT_INDICATED",
    "ALLERGY_CROSS_SENSITIVITY_ERROR",
    "CEFAZOLIN_HELD_ALLERGY",
}
ABC_CODES = {"SET_BED_FOWLERS", "ADMINISTER_O2", "PAUSE_PCA"}
OPIOID_CRISIS_CODES = {
    "OPIOID_DEMAND_BOLUS_TRAP",
    "SALINE_FLUSH_TRAP",
    "OPIOID_MASKING_BRADYPNEA",
    "RENARCOTIZATION",
}


class ExitQuestionResponse(BaseModel):
    question_id: str
    selected_option_id: Optional[str] = None


class TelemetryPayload(BaseModel):
    session_id: str
    scenario_id: str
    student_id: str = "anonymous"
    exam_mode: str = "NGN_EXAM_READINESS"
    research_scenario_mapping: Optional[List[str]] = None
    time_limit_sec: int = 300
    total_scenario_time_sec: float = 0
    end_reason: str = "STUDENT_CONCLUDED"
    stabilized_at_end: bool = False
    safety_checks: Dict[str, Any] = Field(default_factory=dict)
    action_timeline: List[Dict[str, Any]] = Field(default_factory=list)
    traps_triggered: List[Dict[str, Any]] = Field(default_factory=list)
    exit_question_responses: List[ExitQuestionResponse] = Field(default_factory=list)
    final_room_state: Dict[str, Any] = Field(default_factory=dict)


def load_scenario() -> Dict[str, Any]:
    try:
        return json.loads(SCENARIO_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


class DomainLedger:
    """Itemised scoring: every award/deduction becomes a finding and (optionally) a decision-tree impact."""

    def __init__(self):
        self.points = {d: 0 for d in DOMAINS}
        self.findings = {d: [] for d in DOMAINS}
        self.step_impacts: Dict[int, List[str]] = {}

    def add(self, domain: str, pts: int, finding: str, step: Optional[int] = None):
        self.points[domain] += pts
        self.findings[domain].append({"points": pts, "text": finding})
        if step is not None and pts != 0:
            label = domain.replace("_", " ").title()
            self.step_impacts.setdefault(step, []).append(f"{pts:+d} {label}")

    def score(self, domain: str) -> int:
        return max(0, min(100, int(round(self.points[domain]))))


def first_event(timeline: List[Dict[str, Any]], codes) -> Optional[Dict[str, Any]]:
    codes = {codes} if isinstance(codes, str) else set(codes)
    return next((e for e in timeline if e.get("action") in codes), None)


def domain_status(score: int, domain: str) -> str:
    if score >= 80:
        return "STRONG"
    if score >= 60:
        return "DEVELOPING"
    return "GAP_IDENTIFIED" if domain == "risk_recognition" else "NEEDS_PRACTICE"


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "Study AI NCLEX-RN NGN Evaluation Engine v3.0"}


@app.post("/api/evaluate")
def evaluate_candidate_action(payload: TelemetryPayload):
    scenario = load_scenario()
    exam = scenario.get("exam_config", {})
    timeline = sorted(payload.action_timeline, key=lambda e: e.get("step", 0))
    sc = payload.safety_checks
    room = payload.final_room_state
    actions = [e.get("action") for e in timeline]
    ledger = DomainLedger()

    def count(code: str) -> int:
        return actions.count(code)

    # ---------- Exit questions (answer keys live in the scenario JSON) ----------
    responses = {r.question_id: r.selected_option_id for r in payload.exit_question_responses}
    question_results = []
    q_correct: Dict[str, bool] = {}
    for q in exam.get("exit_questions", []):
        selected = responses.get(q["question_id"])
        correct = selected == q.get("correct_option_id")
        q_correct[q["question_id"]] = correct
        option_text = {o["id"]: o["text"] for o in q.get("options", [])}
        question_results.append(
            {
                "question_id": q["question_id"],
                "title": q.get("title"),
                "ncsbn_category": q.get("ncsbn_category"),
                "prompt": q.get("prompt"),
                "selected_option_id": selected,
                "selected_option_text": option_text.get(selected),
                "correct_option_id": q.get("correct_option_id"),
                "correct_option_text": option_text.get(q.get("correct_option_id")),
                "is_correct": correct,
                "rationale": q.get("rationale"),
            }
        )
    sbar_correct = q_correct.get("q1_sbar", False)
    abg_correct = q_correct.get("q2_abg", False)

    ended_code_blue = payload.end_reason == "CODE_BLUE_FAILURE"
    first_intervention = first_event(timeline, INTERVENTION_CODES)
    blind_events = [e for e in timeline if e.get("action") == "BLIND_INTERVENTION_PENALTY"]

    # ---------- 1. KNOWLEDGE ----------
    ev = first_event(timeline, "POWER_ON_MONITOR")
    if ev:
        ledger.add("knowledge", 20, "Powered on bedside telemetry (SpO2 + ECG) to establish a baseline.", ev.get("step"))
    else:
        ledger.add("knowledge", 0, "Never powered on the bedside monitor — no objective vital-sign baseline.")
    ev = first_event(timeline, "DOCUMENT_VITALS")
    if ev:
        ledger.add("knowledge", 10, "Documented the abnormal vital signs.", ev.get("step"))
    tab_points = {"mar": 15, "allergies": 15, "notes": 10, "labs": 5}
    for tab, pts in tab_points.items():
        ev = next(
            (e for e in timeline if e.get("action") == "REVIEW_EHR_TAB" and e.get("tab") == tab),
            None,
        )
        if ev:
            ledger.add("knowledge", pts, f"Reviewed EHR {tab.upper()} tab.", ev.get("step"))
        else:
            ledger.add("knowledge", 0, f"Did not review the EHR {tab.upper()} tab.")
    if abg_correct:
        ledger.add("knowledge", 25, "Correctly interpreted the ABG (uncompensated respiratory acidosis) and selected naloxone.")
    else:
        ledger.add("knowledge", 0, "Missed the ABG interpretation / pharmacology follow-up question.")

    # ---------- 2. PRIORITISATION ----------
    if first_intervention is None:
        ledger.add("prioritisation", 0, "No airway/breathing or medication interventions were performed.")
    elif not blind_events:
        ledger.add("prioritisation", 25, "Completed admission safety checks (monitor, ID, MAR, allergies) before intervening.")
    else:
        ledger.add("prioritisation", 0, f"Intervened before completing admission safety checks ({len(blind_events)} blind intervention(s)).")

    ev = first_event(timeline, "SET_BED_FOWLERS")
    if ev:
        ledger.add("prioritisation", 15, "Elevated the head of bed (Fowler's) to support lung expansion.", ev.get("step"))
        if (room.get("bed_angle_deg") or 0) >= 30:
            ledger.add("prioritisation", 5, "Head of bed remained elevated at the end of the bedside phase.")
    else:
        ledger.add("prioritisation", 0, "Never elevated the head of bed.")
    ev = first_event(timeline, "ADMINISTER_O2")
    if ev:
        ledger.add("prioritisation", 15, "Initiated supplemental oxygen per the PRN order.", ev.get("step"))
        if room.get("o2_device"):
            ledger.add("prioritisation", 5, "Supplemental oxygen remained in place at the end of the bedside phase.")
    else:
        ledger.add("prioritisation", 0, "Never applied supplemental oxygen.")

    first_abc = first_event(timeline, ABC_CODES)
    monitor_ev = first_event(timeline, "POWER_ON_MONITOR")
    if first_abc:
        ref_t = monitor_ev.get("timestamp_sec", 0) if monitor_ev else 0
        delay = max(0.0, float(first_abc.get("timestamp_sec", 0)) - float(ref_t))
        if delay <= 90:
            ledger.add("prioritisation", 10, f"First ABC intervention within {delay:.0f}s of recognizing the cues.", first_abc.get("step"))
        elif delay <= 180:
            ledger.add("prioritisation", 5, f"First ABC intervention delayed ({delay:.0f}s after cues available).", first_abc.get("step"))
        else:
            ledger.add("prioritisation", 0, f"First ABC intervention significantly delayed ({delay:.0f}s).")
    for e in timeline:
        if e.get("action") == "TRENDELENBURG_TRAP":
            ledger.add("prioritisation", -20, "Placed the patient in Trendelenburg, worsening diaphragmatic excursion.", e.get("step"))
    if sbar_correct:
        ledger.add("prioritisation", 25, "Selected a complete, structured SBAR escalation with a specific recommendation.")
    else:
        ledger.add("prioritisation", 0, "SBAR escalation was incomplete or unsafe.")

    # ---------- 3. RISK RECOGNITION ----------
    ev = first_event(timeline, "VERIFY_PATIENT_ID")
    if ev:
        ledger.add("risk_recognition", 15, "Verified the wristband with two identifiers.", ev.get("step"))
        if first_intervention is None or ev.get("step", 0) < first_intervention.get("step", 0):
            ledger.add("risk_recognition", 5, "Patient identity confirmed before any intervention.")
    else:
        ledger.add("risk_recognition", 0, "Never verified patient identity.")
    ev = first_event(timeline, "FLAG_ALLERGY")
    if ev:
        ledger.add("risk_recognition", 15, "Flagged the penicillin anaphylaxis allergy.", ev.get("step"))
    else:
        ledger.add("risk_recognition", 0, "Did not flag the penicillin anaphylaxis allergy.")

    pause_ev = first_event(timeline, "PAUSE_PCA")
    if room.get("pca_paused"):
        ledger.add("risk_recognition", 30, "Morphine PCA was paused (opioid source controlled).", pause_ev.get("step") if pause_ev else None)
    elif pause_ev:
        ledger.add("risk_recognition", 10, "Paused the morphine PCA but it was later resumed.", pause_ev.get("step"))
    else:
        ledger.add("risk_recognition", 0, "Morphine PCA was never paused despite respiratory depression cues.")

    crisis = first_event(timeline, OPIOID_CRISIS_CODES)
    if crisis:
        reversal = next(
            (
                e
                for e in timeline
                if e.get("action") == "ADMINISTER_NALOXONE" and e.get("step", 0) > crisis.get("step", 0)
            ),
            None,
        )
        if reversal:
            ledger.add("risk_recognition", 10, "Recognized opioid toxicity and administered naloxone.", reversal.get("step"))
        else:
            ledger.add("risk_recognition", 0, "Opioid toxicity developed but naloxone was not administered.")
    else:
        ledger.add("risk_recognition", 10, "Prevented progression to opioid toxicity.")

    had_critical = ended_code_blue or any(a in CRITICAL_CODES for a in actions)
    if not had_critical:
        ledger.add("risk_recognition", 25, "No critical safety events.")
    penalty_map = {
        "ALLERGY_CROSS_SENSITIVITY_ERROR": (-40, "Administered cefazolin despite penicillin anaphylaxis (cross-sensitivity risk)."),
        "OPIOID_DEMAND_BOLUS_TRAP": (-30, "Gave an additional opioid bolus to a patient with respiratory depression."),
        "SALINE_FLUSH_TRAP": (-20, "Rapid-flushed the PCA line, bolusing residual morphine."),
        "CONTINUE_BASAL_TRAP": (-15, "Chose to continue the basal morphine infusion."),
    }
    for e in timeline:
        if e.get("action") in penalty_map:
            pts, text = penalty_map[e["action"]]
            ledger.add("risk_recognition", pts, text, e.get("step"))
    blind_total = 0
    for e in blind_events:
        if blind_total <= -20:
            break
        ledger.add("risk_recognition", -5, f"Blind intervention: {e.get('detail', '')}", e.get("step"))
        blind_total -= 5

    # ---------- 4. CLINICAL JUDGMENT ----------
    end_spo2 = (room.get("vitals") or {}).get("spo2", 0) or 0
    if payload.stabilized_at_end:
        ledger.add("clinical_judgment", 35, "Patient met stabilization criteria at the end of the bedside phase (SpO2 ≥ 95%, RR ≥ 14, PCA paused).")
    elif end_spo2 >= 90 and not ended_code_blue:
        ledger.add("clinical_judgment", 15, f"Partial improvement (SpO2 {end_spo2}%) but stabilization criteria not met.")
    else:
        ledger.add("clinical_judgment", 0, f"Patient was not stabilized (final SpO2 {end_spo2}%).")
    if payload.end_reason == "STUDENT_CONCLUDED":
        ledger.add("clinical_judgment", 10, "Concluded bedside care and escalated within the time limit.")
    elif payload.end_reason == "TIME_EXPIRED":
        ledger.add("clinical_judgment", 0, "Did not escalate before the time limit expired.")
    ledger.add("clinical_judgment", 15 if sbar_correct else 0, "SBAR escalation question " + ("correct." if sbar_correct else "incorrect."))
    ledger.add("clinical_judgment", 15 if abg_correct else 0, "ABG follow-up question " + ("correct." if abg_correct else "incorrect."))
    trap_count = sum(1 for a in actions if a in TRAP_CODES)
    ledger.add(
        "clinical_judgment",
        max(0, 25 - 10 * trap_count),
        "Distractor avoidance: no clinical distractors selected (full credit)." if trap_count == 0 else f"Distractor avoidance: {trap_count} clinical distractor(s) selected (partial credit, -10 each from 25).",
    )
    if ended_code_blue:
        excess = ledger.points["clinical_judgment"] - 25
        if excess > 0:
            ledger.add("clinical_judgment", -excess, "Code Blue failure caps clinical judgment at 25.")

    scores = {d: ledger.score(d) for d in DOMAINS}
    overall = int(round(sum(scores.values()) / len(DOMAINS)))

    # ---------- Readiness band ----------
    critical_events = []
    if ended_code_blue:
        critical_events.append("CODE_BLUE_FAILURE")
    critical_events += [a for a in actions if a in CRITICAL_CODES]
    if critical_events:
        band = {
            "level": "BELOW_STANDARD",
            "label": "BELOW PASSING STANDARD — CRITICAL SAFETY EVENT",
            "detail": "A critical patient-safety event occurred. On the NGN exam, unsafe actions outweigh otherwise strong performance.",
        }
    elif overall >= 80:
        band = {"level": "HIGH", "label": "HIGH LIKELIHOOD OF PASSING", "detail": "Performance is consistently above the passing standard."}
    elif overall >= 65:
        band = {"level": "NEAR", "label": "NEAR PASSING STANDARD", "detail": "Performance is close to the passing standard; targeted review recommended."}
    else:
        band = {"level": "BELOW_STANDARD", "label": "BELOW PASSING STANDARD", "detail": "Significant gaps in clinical judgment for this case type."}

    # ---------- Missed critical actions ----------
    missed = []
    if not sc.get("monitor_powered_on"):
        missed.append("POWER_ON_BEDSIDE_MONITOR")
    if not sc.get("wristband_verified"):
        missed.append("VERIFY_PATIENT_WRISTBAND_ID")
    if not sc.get("allergy_flagged"):
        missed.append("FLAG_PENICILLIN_ANAPHYLAXIS_ALLERGY")
    if not room.get("pca_paused"):
        missed.append("PAUSE_MORPHINE_PCA_INFUSION")
    if not room.get("o2_device"):
        missed.append("APPLY_SUPPLEMENTAL_OXYGEN")
    if (room.get("bed_angle_deg") or 0) < 30:
        missed.append("ELEVATE_HEAD_OF_BED_FOWLERS")

    # ---------- NCJMM layers demonstrated ----------
    layers = []
    if sc.get("monitor_powered_on"):
        layers.append("RECOGNIZE_CUES")
    if sc.get("mar_reviewed") or sc.get("notes_reviewed"):
        layers.append("ANALYZE_CUES")
    if abg_correct:
        layers.append("PRIORITIZE_HYPOTHESES")
    if pause_ev or first_event(timeline, "ADMINISTER_NALOXONE"):
        layers.append("GENERATE_SOLUTIONS")
    if first_event(timeline, {"SET_BED_FOWLERS", "ADMINISTER_O2"}):
        layers.append("TAKE_ACTION")
    reassessed = first_abc is not None and any(
        e.get("action") == "DOCUMENT_VITALS" and e.get("step", 0) > first_abc.get("step", 0)
        for e in timeline
    )
    if reassessed or (payload.stabilized_at_end and payload.end_reason == "STUDENT_CONCLUDED"):
        layers.append("EVALUATE_OUTCOMES")

    topics = []
    if scores["risk_recognition"] < 80:
        topics.append("Opioid-induced respiratory depression: PCA safety, sedation scales & naloxone")
    if any(a == "ALLERGY_CROSS_SENSITIVITY_ERROR" for a in actions) or not sc.get("allergy_flagged"):
        topics.append("Penicillin–cephalosporin cross-sensitivity & allergy verification")
    if scores["prioritisation"] < 80:
        topics.append("Maslow/ABC prioritisation & SBAR escalation")
    if not abg_correct:
        topics.append("ABG interpretation (respiratory acidosis)")
    if not topics:
        topics.append("Maintain readiness: practice a new NGN case type (e.g., transfusion reaction or sepsis)")

    # ---------- Decision tree ----------
    decision_tree = []
    for e in timeline:
        decision_tree.append(
            {
                "step": e.get("step"),
                "timestamp_sec": e.get("timestamp_sec"),
                "action": e.get("action"),
                "label": e.get("label") or e.get("action"),
                "detail": e.get("detail"),
                "station": e.get("station_label"),
                "classification": e.get("classification", "NEUTRAL"),
                "severity": e.get("severity"),
                "rationale": e.get("rationale"),
                "vitals_snapshot": e.get("vitals_snapshot"),
                "score_impact": ledger.step_impacts.get(e.get("step"), []),
            }
        )
    traps = [
        d
        for d in decision_tree
        if d["classification"] in {"TRAP", "CRITICAL_ERROR", "PENALTY"}
    ]

    adaptive_followup = (
        {
            "question_id": "adaptive_opioid_antagonist",
            "ncsbn_category": "Pharmacological and Parenteral Therapies",
            "prompt": "Because the Morphine PCA continued infusing, the patient progresses to severe respiratory depression (RR 6/min, SpO2 78%, EtCO2 64 mmHg). Which PRN medication and nursing action is immediately indicated?",
            "options": [
                "Administer Naloxone (Narcan) 0.4 mg IV push slowly and stop the Morphine PCA infusion.",
                "Administer Flumazenil 0.2 mg IV push over 15 seconds.",
                "Flush the peripheral IV line with 10 mL of 0.9% Normal Saline.",
                "Decrease the Morphine PCA basal rate from 2 mg/hr to 1 mg/hr.",
            ],
            "correct_option_index": 0,
            "rationale": "Naloxone is a competitive mu-opioid receptor antagonist that reverses opioid-induced respiratory depression; stopping the PCA prevents ongoing opioid delivery.",
        }
        if not room.get("pca_paused")
        else {
            "question_id": "adaptive_renarcotization_monitoring",
            "ncsbn_category": "Reduction of Risk Potential / Physiological Adaptation",
            "prompt": "Thirty minutes after stabilizing the patient and pausing the Morphine PCA, why must the nurse continue close respiratory and sedation monitoring (Pasero Opioid-Induced Sedation Scale)?",
            "options": [
                "Naloxone has a shorter biological half-life (30–90 min) than morphine, creating a risk of renarcotization and recurrent respiratory depression.",
                "Supplemental oxygen via Non-Rebreather permanently eliminates hypercapnia.",
                "Fowler’s position increases venous return to the right atrium and causes pulmonary edema.",
                "Cefazolin cross-reacts with opioid receptors after 30 minutes.",
            ],
            "correct_option_index": 0,
            "rationale": "Because naloxone is metabolized faster than most opioids, sedation and respiratory depression can recur ('renarcotization') once the antagonist wears off.",
        }
    )

    return {
        "session_id": payload.session_id,
        "scenario_id": payload.scenario_id,
        "exam_mode": payload.exam_mode,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "Study AI NGN Evaluation Engine v3.0 (FastAPI :8000)",
        "overall_competency_score": overall,
        "readiness_band": band,
        "end_reason": payload.end_reason,
        "end_reason_text": exam.get("end_reasons", {}).get(payload.end_reason, payload.end_reason),
        "time_used_sec": payload.total_scenario_time_sec,
        "time_limit_sec": payload.time_limit_sec,
        "stabilized_at_end": payload.stabilized_at_end,
        "critical_safety_events": critical_events,
        "diagnostic_breakdown": {
            d: {
                "score": scores[d],
                "ncsbn_domain": NCSBN_DOMAINS[d],
                "status": domain_status(scores[d], d),
                "findings": ledger.findings[d],
            }
            for d in DOMAINS
        },
        "ncjmm_layers_demonstrated": layers,
        "missed_critical_actions": missed,
        "recommended_practice_topics": topics,
        "exit_questions": question_results,
        "adaptive_followup_question": adaptive_followup,
        "decision_tree": decision_tree,
        "traps_triggered": traps,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
