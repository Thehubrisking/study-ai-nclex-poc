# StudyAI Platform Integration Spec — 3D Bedside Simulation (`v3.1`)

- **Prepared For:** Oluwaseun Adeyo (Backend / Full-Stack Engineering)
- **Simulation App:** Next.js (`frontend/`) + optional standalone FastAPI mirror (`backend-mock/main.py`)
- **Scenario Version:** `nclex_poc_laparotomy_v3` (`v3.1`)

---

## 1. Direct-into-3D Launch URL (No Duplicate Entry Page)

Because the StudyAI main frontend already renders the Entry Assessment introduction screen (`"Before we build your plan, show us how you think"`), redirect or embed the 3D simulation with `?autostart=1` so the candidate enters the timed 3D hospital room immediately without seeing a second briefing page:

```text
https://<3d-sim-domain>/?autostart=1&session_id=sess_99281&student_id=usr_chidinma_01&callback_url=https://api.studyai.pro/v1/assessments/3d-complete&return_url=https://app.studyai.pro/dashboard
```

### Supported Query Parameters
| Query Param | Required | Description |
|---|---|---|
| `autostart=1` (or `skip_intro=1` / `entry=direct`) | Recommended | Skips `BriefingModal` and starts the 5-minute (`300s`) timed 3D bedside phase immediately. Standalone `/` without `autostart=1` retains the intro screen for SME demos. |
| `session_id` | Optional | Passed straight through into `payload.session_id` and `evaluation.session_id` (auto-generated if omitted). |
| `student_id` | Optional | Passed straight through into `payload.student_id` and `evaluation.student_id`. |
| `callback_url` | Optional | If provided, the browser `POST`s `{ payload, evaluation }` (JSON) to this webhook as soon as scoring finishes. |
| `return_url` | Optional | Renders a primary **"Return to StudyAI dashboard"** button on the final Gap Chart screen linking back to the main app. |

---

## 2. Authoritative Scenario & Answer-Key Ingestion (`GET /api/scenario`)

To ingest the scenario metadata, station questions, exit questions, and RN SME-vetted answer keys into the StudyAI database:

- **Next.js Route:** `GET /api/scenario`
- **FastAPI Mirror:** `GET http://localhost:8000/api/scenario`

### Response Shape
```json
{
  "status": "ok",
  "scenario_id": "nclex_poc_laparotomy_v3",
  "version": "3.0",
  "title": "Post-Exploratory Laparotomy: Opioid Respiratory Depression, Hemorrhage & Wound Risk",
  "sme_vetting_status": "READY_FOR_RN_SME_SIGN_OFF",
  "answer_key_summary": {
    "mandatory_bedside_safety_checks": ["..."],
    "priority_clinical_interventions": ["..."],
    "clinical_traps_penalized": ["..."],
    "station_questions": [
      {
        "station_id": "bedside_monitor",
        "question_id": "sq_monitor_cues",
        "domain": "knowledge",
        "ncsbn_category": "Physiological Adaptation",
        "prompt": "...",
        "options": [{ "id": "A", "text": "..." }, { "id": "B", "text": "..." }],
        "correct_option_id": "B",
        "rationale": "..."
      }
    ],
    "exit_questions": [
      {
        "question_id": "q1_sbar",
        "domain": "prioritisation",
        "title": "Question 1 of 4 • SBAR Surgical Escalation",
        "correct_option_id": "B",
        "options": ["..."],
        "rationale": "..."
      }
    ]
  },
  "scenario": { "...full frontend/config/scenario_hypoxia.json..." }
}
```

---

## 3. Evaluation Endpoint & Completion Delivery (`POST /api/evaluate`)

When the candidate finishes the 4 Exit Questions, the frontend submits the structured bedside trace to `POST /api/evaluate` (or `NEXT_PUBLIC_AI_BACKEND_URL` if set).

### Completion Events Emitted Automatically
1. **Iframe `postMessage` (when embedded in StudyAI web app):**
   ```js
   window.addEventListener('message', (event) => {
     if (event.data?.type === 'STUDYAI_SIMULATION_COMPLETE') {
       const { payload, evaluation } = event.data;
       // Persist evaluation.overall_competency_score, diagnostic_breakdown, decision_tree, etc.
     }
   });
   ```
2. **Webhook `POST` (when `callback_url` query parameter is supplied):**
   Sends `Content-Type: application/json` body `{ "payload": {...}, "evaluation": {...} }`.

### Key Fields in `evaluation` (`v3.1`)
- `overall_competency_score`: `0–100` integer
- `readiness_band`: `{ level: "HIGH" | "NEAR" | "BELOW_STANDARD", label, detail }`
- `total_critical_actions`: `8`
- `missed_critical_actions`: array of missed safety/priority codes (e.g. `RAISE_BED_SIDE_RAILS`, `ASSESS_JP_SURGICAL_DRAIN_HEMORRHAGE`, `PAUSE_MORPHINE_PCA_INFUSION`)
- `diagnostic_breakdown`: 4 StudyAI domains (`knowledge`, `prioritisation`, `risk_recognition`, `clinical_judgment`), each `0–100` with itemised `findings`
- `station_questions`: graded results + rationales for `sq_monitor_cues`, `sq_ehr_cross_check`, `sq_surgical_wound`
- `exit_questions`: graded results + rationales for `q1_sbar`, `q2_abg`, `q3_hemorrhage_jp`, `q4_dehiscence_evisceration`
- `decision_tree`: chronological bedside action trace with `score_impact` chips and clinical rationales
