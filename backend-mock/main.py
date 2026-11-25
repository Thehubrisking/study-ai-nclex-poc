"""
Study AI — NCLEX-RN NGN Exam Readiness Evaluation Engine (v3.1)

Scores a strict, timed bedside attempt into Study AI's 4 mandatory diagnostic domains
(knowledge, prioritisation, risk_recognition, clinical_judgment) for the post-exploratory
laparotomy dual-complication scenario (Opioid Respiratory Depression + Postoperative Hemorrhage
/ Wound Dehiscence & Evisceration Risk).

Clinical content (station-question & exit-question answer keys, rationales, event labels) is read
from the shared scenario file `frontend/config/scenario_hypoxia.json` on every request, and exposed
at `GET /api/scenario` for main-platform database ingestion.
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
    version="3.1",
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
    "REMOVE_PRIMARY_DRESSING_TRAP",
    "LEAVE_JP_OPEN_TRAP",
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
    "INITIATE_CRYSTALLOID_BOLUS",
    "REMOVE_PRIMARY_DRESSING_TRAP",
    "LEAVE_JP_OPEN_TRAP",
}
ABC_CODES = {
    "SET_BED_FOWLERS",
    "ADMINISTER_O2",
    "PAUSE_PCA",
    "INITIATE_CRYSTALLOID_BOLUS",
}
OPIOID_CRISIS_CODES = {
    "OPIOID_DEMAND_BOLUS_TRAP",
    "SALINE_FLUSH_TRAP",
    "OPIOID_MASKING_BRADYPNEA",
    "RENARCOTIZATION",
}


class QuestionResponse(BaseModel):
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
    station_question_responses: List[QuestionResponse] = Field(default_factory=list)
    exit_question_responses: List[QuestionResponse] = Field(default_factory=list)
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
@app.get("/api/evaluate")
def health_check():
    scenario = load_scenario()
    return {
        "status": "ok",
        "service": "StudyAI NCLEX-RN 3D Simulation & NGN Evaluation Engine",
        "version": scenario.get("version", "3.2"),
        "scenario_id": scenario.get("scenario_id", "nclex_poc_laparotomy_v3"),
    }


@app.get("/api/scenario")
def get_authoritative_scenario():
    scenario = load_scenario()
    exam = scenario.get("exam_config", {})
    station_labels = exam.get("station_labels", {})
    station_questions = [
        {
            "station_id": sid,
            "station_label": station_labels.get(sid, sid),
            "question_id": sq.get("question_id"),
            "domain": sq.get("domain"),
            "ncsbn_category": sq.get("ncsbn_category"),
            "prompt": sq.get("prompt"),
            "options": sq.get("options"),
            "correct_option_id": sq.get("correct_option_id"),
            "rationale": sq.get("rationale"),
        }
        for sid, sq in (exam.get("station_questions") or {}).items()
    ]
    exit_questions = [
        {
            "question_id": q.get("question_id"),
            "domain": q.get("domain"),
            "title": q.get("title"),
            "ncsbn_category": q.get("ncsbn_category"),
            "prompt": q.get("prompt"),
            "options": q.get("options"),
            "correct_option_id": q.get("correct_option_id"),
            "rationale": q.get("rationale"),
        }
        for q in (exam.get("exit_questions") or [])
    ]
    return {
        "status": "ok",
        "scenario_id": scenario.get("scenario_id"),
        "version": scenario.get("version"),
        "title": scenario.get("title"),
        "sme_vetting_status": "READY_FOR_RN_SME_SIGN_OFF",
        "answer_key_summary": {
            "mandatory_bedside_safety_checks": [
                "POWER_ON_MONITOR",
                "VERIFY_PATIENT_ID",
                "RAISE_SIDE_RAILS",
                "REVIEW_EHR_TAB (MAR, ALLERGIES, NOTES, LABS)",
                "FLAG_ALLERGY (Penicillin Anaphylaxis -> Hold Cefazolin)",
            ],
            "priority_clinical_interventions": [
                "PAUSE_PCA (Stop continuous Morphine 2 mg/hr infusion)",
                "SET_BED_FOWLERS (Elevate HOB >= 30° Semi-Fowler's)",
                "ADMINISTER_O2 (Apply supplemental oxygen)",
                "ASSESS_JP_HEMORRHAGE (Measure 135 mL/hr sanguineous JP drain, re-compress bulb, reinforce primary gauze)",
                "INITIATE_CRYSTALLOID_BOLUS (Start PRN 0.9% Normal Saline 500 mL IV bolus for BP 92/58)",
                "VERIFY_GTUBE (Confirm LUQ gastrostomy wafer seal & bilious return)",
            ],
            "clinical_traps_penalized": [
                "ALLERGY_CROSS_SENSITIVITY_ERROR (-40 Risk Recognition, Critical Safety Event)",
                "OPIOID_DEMAND_BOLUS_TRAP (-30 Risk Recognition, Critical Safety Event)",
                "SALINE_FLUSH_TRAP (-20 Risk Recognition)",
                "REMOVE_PRIMARY_DRESSING_TRAP (-20 Risk Recognition)",
                "TRENDELENBURG_TRAP (-20 Prioritisation)",
                "LEAVE_JP_OPEN_TRAP (-15 Risk Recognition)",
                "CONTINUE_BASAL_TRAP (-15 Risk Recognition)",
            ],
            "station_questions": station_questions,
            "exit_questions": exit_questions,
        },
        "scenario": scenario,
    }


@app.post("/api/evaluate")
def evaluate_candidate_action(payload: TelemetryPayload):
    scenario = load_scenario()
    exam = scenario.get("exam_config", {})
    station_labels = exam.get("station_labels", {})
    timeline = sorted(payload.action_timeline, key=lambda e: e.get("step", 0))
    sc = payload.safety_checks
    room = payload.final_room_state
    actions = [e.get("action") for e in timeline]
    ledger = DomainLedger()

    # ---------- In-Station Micro-Questions ----------
    sq_responses = {r.question_id: r.selected_option_id for r in payload.station_question_responses}
    station_question_results = []
    sq_correct: Dict[str, bool] = {}
    for sid, sq in (exam.get("station_questions") or {}).items():
        qid = sq.get("question_id")
        selected = sq_responses.get(qid)
        correct = selected == sq.get("correct_option_id")
        sq_correct[qid] = correct
        option_text = {o["id"]: o["text"] for o in sq.get("options", [])}
        station_question_results.append(
            {
                "question_id": qid,
                "station_id": sid,
                "station_label": station_labels.get(sid, sid),
                "ncsbn_category": sq.get("ncsbn_category"),
                "prompt": sq.get("prompt"),
                "selected_option_id": selected,
                "selected_option_text": option_text.get(selected),
                "correct_option_id": sq.get("correct_option_id"),
                "correct_option_text": option_text.get(sq.get("correct_option_id")),
                "is_correct": correct,
                "rationale": sq.get("rationale"),
            }
        )

    # ---------- Exit Questions (4 post-laparotomy NCLEX questions) ----------
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
    hemorrhage_q_correct = q_correct.get("q3_hemorrhage_jp", False)

    ended_code_blue = payload.end_reason == "CODE_BLUE_FAILURE"
    first_intervention = first_event(timeline, INTERVENTION_CODES)
    blind_events = [e for e in timeline if e.get("action") == "BLIND_INTERVENTION_PENALTY"]

    # ---------- 1. KNOWLEDGE (Max 100) ----------
    ev = first_event(timeline, "POWER_ON_MONITOR")
    if ev:
        ledger.add("knowledge", 15, "Powered on bedside telemetry (SpO2, HR, BP, RR, EtCO2) to establish an objective baseline.", ev.get("step"))
    else:
        ledger.add("knowledge", 0, "Never powered on the bedside monitor — no objective vital-sign baseline.")

    ev = first_event(timeline, "DOCUMENT_VITALS")
    if ev:
        ledger.add("knowledge", 5, "Documented the abnormal post-laparotomy vital signs.", ev.get("step"))

    tab_points = {"mar": 10, "allergies": 10, "notes": 10, "labs": 10}
    for tab, pts in tab_points.items():
        ev = next(
            (e for e in timeline if e.get("action") == "REVIEW_EHR_TAB" and e.get("tab") == tab),
            None,
        )
        if ev:
            ledger.add("knowledge", pts, f"Reviewed EHR {tab.upper()} tab.", ev.get("step"))
        else:
            ledger.add("knowledge", 0, f"Did not review the EHR {tab.upper()} tab.")

    ev = first_event(timeline, "VERIFY_GTUBE")
    if ev or sc.get("gtube_verified") or room.get("gtube_verified"):
        ledger.add("knowledge", 5, "Verified left-upper-quadrant gastrostomy (G-tube) wafer seal and bilious decompression return.", ev.get("step") if ev else None)
    else:
        ledger.add("knowledge", 0, "Did not verify gastrostomy (G-tube) site integrity.")

    for sq_res in station_question_results:
        if sq_res["is_correct"]:
            ledger.add("knowledge", 5, f"Answered {sq_res['station_label']} clinical cue check ({sq_res['question_id']}) correctly.")
        else:
            ledger.add("knowledge", 0, f"Missed or skipped {sq_res['station_label']} clinical cue check ({sq_res['question_id']}).")

    if abg_correct:
        ledger.add("knowledge", 20, "Correctly interpreted the ABG (uncompensated respiratory acidosis) and selected naloxone.")
    else:
        ledger.add("knowledge", 0, "Missed the ABG interpretation / opioid reversal exit question.")

    # ---------- 2. PRIORITISATION (Max 100) ----------
    if first_intervention is None:
        ledger.add("prioritisation", 0, "No airway, hemodynamic, or medication interventions were performed.")
    elif not blind_events:
        ledger.add("prioritisation", 20, "Completed admission safety checks (monitor, ID, side rails, MAR, allergies) before intervening.")
    else:
        ledger.add("prioritisation", 0, f"Intervened before completing admission safety checks ({len(blind_events)} blind intervention(s)).")

    ev = first_event(timeline, "SET_BED_FOWLERS")
    if ev:
        ledger.add("prioritisation", 12, "Elevated the head of bed (Semi/High Fowler's) to support diaphragmatic excursion.", ev.get("step"))
        if (room.get("bed_angle_deg") or 0) >= 30:
            ledger.add("prioritisation", 3, "Head of bed remained elevated at the end of the bedside phase.")
    else:
        ledger.add("prioritisation", 0, "Never elevated the head of bed.")

    ev = first_event(timeline, "ADMINISTER_O2")
    if ev:
        ledger.add("prioritisation", 12, "Initiated supplemental oxygen per the PRN order.", ev.get("step"))
        if room.get("o2_device"):
            ledger.add("prioritisation", 3, "Supplemental oxygen remained in place at the end of the bedside phase.")
    else:
        ledger.add("prioritisation", 0, "Never applied supplemental oxygen.")

    ev = first_event(timeline, "INITIATE_CRYSTALLOID_BOLUS")
    if ev or room.get("crystalloid_bolus"):
        ledger.add("prioritisation", 10, "Initiated PRN 0.9% Normal Saline 500 mL IV bolus via secondary port for hemorrhagic hypotension.", ev.get("step") if ev else None)
    else:
        ledger.add("prioritisation", 0, "Did not initiate the PRN 0.9% Normal Saline IV bolus despite hypotension (BP 92/58) and tachycardia.")

    first_abc = first_event(timeline, ABC_CODES)
    monitor_ev = first_event(timeline, "POWER_ON_MONITOR")
    if first_abc:
        ref_t = monitor_ev.get("timestamp_sec", 0) if monitor_ev else 0
        delay = max(0.0, float(first_abc.get("timestamp_sec", 0)) - float(ref_t))
        if delay <= 90:
            ledger.add("prioritisation", 10, f"First ABC/hemodynamic intervention within {delay:.0f}s of recognizing the cues.", first_abc.get("step"))
        elif delay <= 180:
            ledger.add("prioritisation", 5, f"First ABC/hemodynamic intervention delayed ({delay:.0f}s after cues available).", first_abc.get("step"))
        else:
            ledger.add("prioritisation", 0, f"First ABC/hemodynamic intervention significantly delayed ({delay:.0f}s).")

    for e in timeline:
        if e.get("action") == "TRENDELENBURG_TRAP":
            ledger.add("prioritisation", -20, "Placed the patient in Trendelenburg, worsening diaphragmatic excursion.", e.get("step"))

    if sbar_correct:
        ledger.add("prioritisation", 15, "Selected a complete SBAR surgical escalation covering both opioid depression and active JP hemorrhage.")
    else:
        ledger.add("prioritisation", 0, "SBAR surgical escalation was incomplete or unsafe.")

    if hemorrhage_q_correct:
        ledger.add("prioritisation", 15, "Correctly identified the postoperative hemorrhage & JP drain shock triad requiring STAT surgical escalation.")
    else:
        ledger.add("prioritisation", 0, "Missed the postoperative hemorrhage & JP drain recognition exit question.")

    # ---------- 3. RISK RECOGNITION (Max 100) ----------
    ev = first_event(timeline, "VERIFY_PATIENT_ID")
    if ev:
        ledger.add("risk_recognition", 10, "Verified the wristband with two identifiers.", ev.get("step"))
        if first_intervention is None or ev.get("step", 0) < first_intervention.get("step", 0):
            ledger.add("risk_recognition", 5, "Patient identity confirmed before any intervention.")
    else:
        ledger.add("risk_recognition", 0, "Never verified patient identity.")

    ev = first_event(timeline, "RAISE_SIDE_RAILS")
    partial_rail_ev = first_event(timeline, "RAISE_SIDE_RAIL_PARTIAL")
    if sc.get("side_rails_raised") or room.get("side_rails_up"):
        ledger.add(
            "risk_recognition",
            10,
            "Visually observed lowered bed rails and raised & locked both bedside safety rails.",
            ev.get("step") if ev else (partial_rail_ev.get("step") if partial_rail_ev else None),
        )
    elif sc.get("rails_raised_count") == 1 or room.get("left_rail_up") or room.get("right_rail_up"):
        ledger.add(
            "risk_recognition",
            5,
            "Raised 1 of 2 bedside safety rails; opposite side rail remained lowered.",
            partial_rail_ev.get("step") if partial_rail_ev else None,
        )
    else:
        ledger.add(
            "risk_recognition",
            0,
            "Left both bedside safety rails lowered despite opioid sedation and hypotension (fall hazard).",
        )

    ev = first_event(timeline, "FLAG_ALLERGY")
    if ev:
        ledger.add("risk_recognition", 10, "Flagged the penicillin anaphylaxis allergy.", ev.get("step"))
    else:
        ledger.add("risk_recognition", 0, "Did not flag the penicillin anaphylaxis allergy.")

    pause_ev = first_event(timeline, "PAUSE_PCA")
    if room.get("pca_paused"):
        ledger.add("risk_recognition", 25, "Morphine PCA was paused (opioid source controlled).", pause_ev.get("step") if pause_ev else None)
    elif pause_ev:
        ledger.add("risk_recognition", 10, "Paused the morphine PCA but it was later resumed.", pause_ev.get("step"))
    else:
        ledger.add("risk_recognition", 0, "Morphine PCA was never paused despite respiratory depression cues.")

    jp_ev = first_event(timeline, "ASSESS_JP_HEMORRHAGE")
    if room.get("jp_assessed") or sc.get("jp_hemorrhage_assessed") or jp_ev:
        ledger.add(
            "risk_recognition",
            15,
            "Measured 135 mL/hr sanguineous JP drain output, re-compressed the bulb for suction, reinforced strikethrough gauze, and flagged hemorrhage.",
            jp_ev.get("step") if jp_ev else None,
        )
    else:
        ledger.add("risk_recognition", 0, "Never assessed the blood-saturated laparotomy dressing or 135 mL/hr sanguineous JP bulb drain.")

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
            ledger.add("risk_recognition", 5, "Recognized opioid toxicity and administered naloxone.", reversal.get("step"))
        else:
            ledger.add("risk_recognition", 0, "Opioid toxicity developed but naloxone was not administered.")
    else:
        ledger.add("risk_recognition", 5, "Prevented progression to acute opioid toxicity.")

    if "UNRECOGNIZED_HEMORRHAGE_ESCALATION" not in actions and not room.get("hemorrhage_shock"):
        ledger.add("risk_recognition", 5, "Addressed surgical bleeding / hemodynamics before progression to decompensated hypovolemic shock.")
    else:
        ledger.add("risk_recognition", 0, "Unaddressed surgical bleeding progressed to worsening hypovolemic shock (HR 136, BP 78/46).")

    had_critical = ended_code_blue or any(a in CRITICAL_CODES for a in actions)
    if not had_critical:
        ledger.add("risk_recognition", 15, "No critical safety events.")

    penalty_map = {
        "ALLERGY_CROSS_SENSITIVITY_ERROR": (-40, "Administered cefazolin despite penicillin anaphylaxis (cross-sensitivity risk)."),
        "OPIOID_DEMAND_BOLUS_TRAP": (-30, "Gave an additional opioid bolus to a patient with respiratory depression and hypotension."),
        "SALINE_FLUSH_TRAP": (-20, "Rapid-flushed the PCA line, bolusing residual morphine."),
        "REMOVE_PRIMARY_DRESSING_TRAP": (-20, "Peeled off the surgeon's primary laparotomy dressing (<24 hr post-op), disrupting hemostatic clots."),
        "LEAVE_JP_OPEN_TRAP": (-15, "Left the JP bulb uncompressed and open to air, eliminating closed suction and creating an infection portal."),
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

    # ---------- 4. CLINICAL JUDGMENT (Max 100) ----------
    end_spo2 = (room.get("vitals") or {}).get("spo2", 0) or 0
    if payload.stabilized_at_end:
        ledger.add("clinical_judgment", 35, "Patient met full stabilization criteria (SpO2 ≥ 95%, RR ≥ 14, PCA paused, JP surgical hemorrhage assessed).")
    elif end_spo2 >= 90 and not ended_code_blue:
        ledger.add("clinical_judgment", 15, f"Partial improvement (SpO2 {end_spo2}%) but full respiratory + surgical stabilization criteria were not met.")
    else:
        ledger.add("clinical_judgment", 0, f"Patient was not stabilized (final SpO2 {end_spo2}%).")

    if payload.end_reason == "STUDENT_CONCLUDED":
        ledger.add("clinical_judgment", 10, "Concluded bedside care and escalated within the time limit.")
    elif payload.end_reason == "TIME_EXPIRED":
        ledger.add("clinical_judgment", 0, "Did not escalate before the time limit expired.")

    for q_res in question_results:
        ledger.add("clinical_judgment", 5 if q_res["is_correct"] else 0, f"{q_res['title']}: {'correct.' if q_res['is_correct'] else 'incorrect.'}")

    for sq_res in station_question_results:
        ledger.add("clinical_judgment", 5 if sq_res["is_correct"] else 0, f"In-station NCLEX synthesis ({sq_res['station_label']}): {'correct.' if sq_res['is_correct'] else 'incorrect.'}")

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

    # ---------- Missed critical actions (8 bedside safety & priority actions) ----------
    total_critical_actions = 8
    missed = []
    if not sc.get("monitor_powered_on"):
        missed.append("POWER_ON_BEDSIDE_MONITOR")
    if not sc.get("wristband_verified"):
        missed.append("VERIFY_PATIENT_WRISTBAND_ID")
    if not sc.get("side_rails_raised") and not room.get("side_rails_up"):
        missed.append("RAISE_BED_SIDE_RAILS")
    if not sc.get("allergy_flagged"):
        missed.append("FLAG_PENICILLIN_ANAPHYLAXIS_ALLERGY")
    if not room.get("pca_paused"):
        missed.append("PAUSE_MORPHINE_PCA_INFUSION")
    if not room.get("o2_device"):
        missed.append("APPLY_SUPPLEMENTAL_OXYGEN")
    if (room.get("bed_angle_deg") or 0) < 30:
        missed.append("ELEVATE_HEAD_OF_BED_FOWLERS")
    if not room.get("jp_assessed") and not sc.get("jp_hemorrhage_assessed"):
        missed.append("ASSESS_JP_SURGICAL_DRAIN_HEMORRHAGE")

    # ---------- NCJMM layers demonstrated ----------
    layers = []
    if sc.get("monitor_powered_on"):
        layers.append("RECOGNIZE_CUES")
    if sc.get("mar_reviewed") or sc.get("notes_reviewed") or sc.get("labs_reviewed"):
        layers.append("ANALYZE_CUES")
    if abg_correct or hemorrhage_q_correct:
        layers.append("PRIORITIZE_HYPOTHESES")
    if pause_ev or first_event(timeline, "ADMINISTER_NALOXONE") or first_event(timeline, "ASSESS_JP_HEMORRHAGE"):
        layers.append("GENERATE_SOLUTIONS")
    if first_event(timeline, {"SET_BED_FOWLERS", "ADMINISTER_O2", "INITIATE_CRYSTALLOID_BOLUS"}):
        layers.append("TAKE_ACTION")
    reassessed = first_abc is not None and any(
        e.get("action") == "DOCUMENT_VITALS" and e.get("step", 0) > first_abc.get("step", 0)
        for e in timeline
    )
    if reassessed or (payload.stabilized_at_end and payload.end_reason == "STUDENT_CONCLUDED"):
        layers.append("EVALUATE_OUTCOMES")

    topics = []
    if (
        not room.get("jp_assessed")
        or not hemorrhage_q_correct
        or sq_correct.get("sq_surgical_wound") is False
        or "REMOVE_PRIMARY_DRESSING_TRAP" in actions
        or "LEAVE_JP_OPEN_TRAP" in actions
    ):
        topics.append("Postoperative hemorrhage: Jackson-Pratt (JP) bulb closed suction, dressing reinforcement (<24 hr post-op) & hypovolemic shock cues")
    if scores["risk_recognition"] < 80 or not room.get("pca_paused"):
        topics.append("Opioid-induced respiratory depression: PCA safety, fall precautions (side rails) & naloxone")
    if any(a == "ALLERGY_CROSS_SENSITIVITY_ERROR" for a in actions) or not sc.get("allergy_flagged"):
        topics.append("Penicillin–cephalosporin cross-sensitivity & allergy verification")
    if scores["prioritisation"] < 80:
        topics.append("Maslow/ABC prioritisation, isotonic fluid resuscitation & SBAR surgical escalation")
    if not abg_correct:
        topics.append("ABG interpretation (uncompensated respiratory acidosis)")
    if not topics:
        topics.append("Maintain readiness: practice a new NGN case type (e.g., acute blood transfusion reaction or septic shock)")

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

    if not room.get("jp_assessed") or "REMOVE_PRIMARY_DRESSING_TRAP" in actions:
        adaptive_followup = {
            "question_id": "adaptive_jp_drain_suction",
            "ncsbn_category": "Reduction of Risk Potential",
            "prompt": "When emptying and resetting a Jackson-Pratt (JP) closed-wound suction drain that contains 135 mL of bright-red sanguineous fluid, how must the nurse re-establish negative-pressure suction and manage the saturated primary laparotomy gauze (<24 hr post-op)?",
            "options": [
                "Open the pouring spout, measure drainage in a calibrated cup, fully compress the bulb flat with your hand BEFORE recapping the plug, and reinforce OVER the primary surgical gauze with sterile abdominal pads while notifying the surgeon STAT.",
                "Recap the pouring spout while the bulb is fully inflated so positive air pressure tamponades the surgical bed, and peel off the bloody primary gauze.",
                "Connect the Jackson-Pratt tubing directly to high continuous wall suction (-200 mmHg).",
                "Leave the JP drain plug uncapped to gravity drainage and irrigate the surgical drain lumen with tap water.",
            ],
            "correct_option_index": 0,
            "rationale": "Compressing the JP bulb flat before sealing the plug creates gentle negative suction; within the first 24 hours post-laparotomy, blood-soaked primary dressings are reinforced (never peeled off) to avoid dislodging clots while escalating to surgery.",
        }
    elif not room.get("pca_paused"):
        adaptive_followup = {
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
    else:
        adaptive_followup = {
            "question_id": "adaptive_renarcotization_monitoring",
            "ncsbn_category": "Reduction of Risk Potential / Physiological Adaptation",
            "prompt": "Thirty minutes after stabilizing the patient and pausing the Morphine PCA, why must the nurse continue close respiratory, sedation (Pasero scale), and JP drain output monitoring?",
            "options": [
                "Naloxone has a shorter half-life (30–90 min) than morphine (risk of renarcotization), and crystalloid resuscitation raising blood pressure can unmask ongoing surgical-bed bleeding.",
                "Supplemental oxygen via Non-Rebreather permanently eliminates hypercapnia.",
                "Semi-Fowler's position causes rapid gastrostomy tube dislodgement.",
                "Cefazolin cross-reacts with opioid receptors after 30 minutes.",
            ],
            "correct_option_index": 0,
            "rationale": "Naloxone wears off faster than morphine ('renarcotization'), and restoring arterial pressure with IV crystalloids can increase bleeding from an unligated mesenteric vessel — requiring serial vital sign and JP output surveillance.",
        }

    return {
        "session_id": payload.session_id,
        "student_id": payload.student_id,
        "scenario_id": payload.scenario_id,
        "exam_mode": payload.exam_mode,
        "evaluated_at": datetime.now(timezone.utc).isoformat(),
        "engine": "Study AI NGN Evaluation Engine v3.1 (FastAPI :8000)",
        "overall_competency_score": overall,
        "readiness_band": band,
        "end_reason": payload.end_reason,
        "end_reason_text": exam.get("end_reasons", {}).get(payload.end_reason, payload.end_reason),
        "time_used_sec": payload.total_scenario_time_sec,
        "time_limit_sec": payload.time_limit_sec,
        "stabilized_at_end": payload.stabilized_at_end,
        "critical_safety_events": critical_events,
        "total_critical_actions": total_critical_actions,
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
        "station_questions": station_question_results,
        "exit_questions": question_results,
        "adaptive_followup_question": adaptive_followup,
        "decision_tree": decision_tree,
        "traps_triggered": traps,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
