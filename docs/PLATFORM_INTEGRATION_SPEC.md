# StudyAI Platform Integration Spec — 3D Bedside Simulation (`v3.2`)

- **Prepared For:** Oluwaseun Adeyo (Backend / Full-Stack Engineering)
- **Simulation App:** Next.js self-contained app (`frontend/`, includes built-in serverless `/api/scenario` & `/api/evaluate` with CORS enabled) + optional FastAPI mirror (`backend-mock/main.py`)
- **Scenario ID:** `nclex_poc_laparotomy_v3`

---

## Quick Endpoint Summary

Let `<SIM_BASE_URL>` be the deployed simulation URL (e.g. `https://sim.studyai.pro` or `http://localhost:3000` locally):

| Method & Path | Purpose | Who Calls It |
|---|---|---|
| `GET <SIM_BASE_URL>/?autostart=1&...` | Launches the 5-minute 3D hospital room directly (skips duplicate intro screen). | StudyAI Frontend (redirect or `<iframe>`) |
| `GET <SIM_BASE_URL>/api/scenario` | Returns the authoritative scenario JSON + 3 in-station questions + 3 exit questions + RN-vetted answer keys & rationales. | StudyAI Backend (DB ingestion / sync) |
| `GET <SIM_BASE_URL>/api/evaluate` | Health check (`{ "status": "ok", "service": "..." }`). | StudyAI Backend / Uptime monitor |
| `POST <SIM_BASE_URL>/api/evaluate` | Scores a student's bedside action timeline + question responses into the 4 StudyAI domains (`0–100` each) + decision tree. | Called automatically by the 3D client (or directly by StudyAI Backend) |
| `POST <YOUR_CALLBACK_URL>` *(Webhook)* | When `callback_url` is passed in the launch URL, the simulation automatically `POST`s `{ payload, evaluation }` to your backend upon completion. | Sent from Simulation -> StudyAI Backend |

*(Note: If running the standalone Python FastAPI service on `:8000`, `GET /api/health`, `GET /api/scenario`, and `POST /api/evaluate` are mirrored identically.)*

---

## 1. Direct-into-3D Launch URL (Skipping Duplicate Intro Page)

Because the main StudyAI frontend already displays the Entry Assessment intro screen, redirect the student (or mount an `<iframe allow="autoplay">`) using `?autostart=1`:

```text
https://<SIM_BASE_URL>/?autostart=1&session_id=sess_99281&student_id=usr_chidinma_01&callback_url=https://api.studyai.pro/v1/assessments/3d-complete&return_url=https://app.studyai.pro/dashboard
```

### Supported Query Parameters
| Query Param | Required | Description |
|---|---|---|
| `autostart=1` *(aliases: `skip_intro=1`, `entry=direct`)* | Recommended | Skips `BriefingModal` and drops the student straight into the timed 5:00 (`300s`) 3D bedside phase. Opening `/` without `autostart=1` keeps the standalone intro screen for demos. |
| `session_id` | Optional | Forwarded into `payload.session_id` and `evaluation.session_id` (auto-generated if omitted). |
| `student_id` | Optional | Forwarded into `payload.student_id` and `evaluation.student_id`. |
| `callback_url` | Optional | URL-encoded StudyAI API endpoint. As soon as scoring completes, the client `POST`s `{ payload, evaluation }` as JSON to this URL. |
| `return_url` | Optional | URL-encoded dashboard URL. Renders a primary **"Return to StudyAI dashboard"** CTA on the Gap Chart screen. |

---

## 2. Ingesting the Vetted Scenario & Answer Key (`GET /api/scenario`)

```bash
curl -s https://<SIM_BASE_URL>/api/scenario | jq .
```

### Response Shape
```json
{
  "status": "ok",
  "scenario_id": "nclex_poc_laparotomy_v3",
  "version": "3.0",
  "title": "Post-Exploratory Laparotomy Deterioration: Opioid Respiratory Depression & Postoperative Hemorrhage",
  "sme_vetting_status": "READY_FOR_RN_SME_SIGN_OFF",
  "answer_key_summary": {
    "mandatory_bedside_safety_checks": [
      "POWER_ON_MONITOR",
      "VERIFY_PATIENT_ID",
      "RAISE_SIDE_RAILS",
      "REVIEW_EHR_TAB (MAR, ALLERGIES, NOTES, LABS)",
      "FLAG_ALLERGY (Penicillin Anaphylaxis -> Hold Cefazolin)"
    ],
    "priority_clinical_interventions": [
      "PAUSE_PCA (Stop continuous Morphine 2 mg/hr infusion)",
      "SET_BED_FOWLERS (Elevate HOB >= 30° Semi-Fowler’s)",
      "ADMINISTER_O2 (Apply supplemental oxygen)",
      "ASSESS_JP_HEMORRHAGE (Measure 135 mL/hr sanguineous JP drain, re-compress bulb, reinforce primary gauze)",
      "INITIATE_CRYSTALLOID_BOLUS (Start PRN 0.9% Normal Saline 500 mL IV bolus for BP 92/58)",
      "VERIFY_GTUBE (Confirm LUQ gastrostomy wafer seal & bilious return)"
    ],
    "clinical_traps_penalized": [
      "ALLERGY_CROSS_SENSITIVITY_ERROR (-40 Risk Recognition, Critical Safety Event)",
      "OPIOID_DEMAND_BOLUS_TRAP (-30 Risk Recognition, Critical Safety Event)",
      "SALINE_FLUSH_TRAP (-20 Risk Recognition)",
      "REMOVE_PRIMARY_DRESSING_TRAP (-20 Risk Recognition)",
      "TRENDELENBURG_TRAP (-20 Prioritisation)",
      "LEAVE_JP_OPEN_TRAP (-15 Risk Recognition)",
      "CONTINUE_BASAL_TRAP (-15 Risk Recognition)"
    ],
    "station_questions": [
      {
        "station_id": "bedside_monitor",
        "station_label": "Bedside Monitor",
        "question_id": "sq_monitor_cues",
        "domain": "knowledge",
        "ncsbn_category": "Physiological Adaptation",
        "prompt": "...",
        "options": [{ "id": "A", "text": "..." }, { "id": "B", "text": "..." }, { "id": "C", "text": "..." }, { "id": "D", "text": "..." }],
        "correct_option_id": "B",
        "rationale": "..."
      }
    ],
    "exit_questions": [
      {
        "question_id": "q1_sbar",
        "domain": "prioritisation",
        "title": "Question 1 of 3 • SBAR Surgical Escalation",
        "ncsbn_category": "Management of Care (15-21%)",
        "prompt": "...",
        "options": ["..."],
        "correct_option_id": "B",
        "rationale": "..."
      }
    ]
  },
  "scenario": { "...complete scenario_hypoxia.json..." }
}
```

---

## 3. Receiving Student Results (`POST /api/evaluate` + Webhook + `postMessage`)

When the student submits the 3 Exit Questions, the simulation evaluates the attempt via `POST /api/evaluate` and immediately delivers `{ payload, evaluation }` through two channels:

### Channel A — Webhook `POST` (Full-Page Redirect Flow)
If `callback_url` was passed in the launch URL, the browser sends:
```http
POST <callback_url>
Content-Type: application/json

{
  "payload": { ...raw telemetry trace... },
  "evaluation": { ...graded Gap Chart breakdown... }
}
```

### Channel B — `window.parent.postMessage` (Iframe Embed Flow)
If you embed the simulation inside an `<iframe>` in the StudyAI React app:
```js
window.addEventListener('message', (event) => {
  if (event.data?.type === 'STUDYAI_SIMULATION_COMPLETE') {
    const { payload, evaluation } = event.data;
    // Save evaluation to StudyAI backend & navigate to student dashboard
  }
});
```

### `evaluation` Object Schema
```json
{
  "session_id": "sess_99281",
  "student_id": "usr_chidinma_01",
  "scenario_id": "nclex_poc_laparotomy_v3",
  "exam_mode": "NGN_EXAM_READINESS",
  "evaluated_at": "2026-11-24T19:05:20.000Z",
  "overall_competency_score": 88,
  "readiness_band": {
    "level": "HIGH",
    "label": "HIGH LIKELIHOOD OF PASSING",
    "detail": "Performance is consistently above the passing standard."
  },
  "end_reason": "STUDENT_CONCLUDED",
  "time_used_sec": 184.2,
  "time_limit_sec": 300,
  "stabilized_at_end": true,
  "critical_safety_events": [],
  "total_critical_actions": 8,
  "missed_critical_actions": [],
  "diagnostic_breakdown": {
    "knowledge": { "score": 90, "ncsbn_domain": "Physiological Adaptation (11-17%)", "status": "STRONG", "findings": [...] },
    "prioritisation": { "score": 85, "ncsbn_domain": "Management of Care (15-21%)", "status": "STRONG", "findings": [...] },
    "risk_recognition": { "score": 90, "ncsbn_domain": "Safety & Infection Control (10-16%) / Pharmacological & Parenteral Therapies (13-19%)", "status": "STRONG", "findings": [...] },
    "clinical_judgment": { "score": 85, "ncsbn_domain": "NCJMM 6-Layer Synthesis • Reduction of Risk Potential (9-15%)", "status": "STRONG", "findings": [...] }
  },
  "ncjmm_layers_demonstrated": ["RECOGNIZE_CUES", "ANALYZE_CUES", "PRIORITIZE_HYPOTHESES", "GENERATE_SOLUTIONS", "TAKE_ACTION", "EVALUATE_OUTCOMES"],
  "recommended_practice_topics": ["..."],
  "station_questions": ["...3 graded bedside questions with selected_option_id, correct_option_id, is_correct, rationale..."],
  "exit_questions": ["...3 graded exit questions with selected_option_id, correct_option_id, is_correct, rationale..."],
  "adaptive_followup_question": { "...1 targeted remediation MCQ..." },
  "decision_tree": ["...step-by-step chronological action log with timestamp_sec, vitals_snapshot & score_impact..."],
  "traps_triggered": []
}
```
