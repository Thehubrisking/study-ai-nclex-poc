# StudyAI Platform & Backend Handoff Specification — 3D Clinical Judgment Simulation (`v3.2`)

- **Prepared For:** Oluwaseun Adeyo (Backend & Platform Engineering)
- **Repository:** `https://github.com/Thehubrisking/study-ai-nclex-poc.git` (`main`)
- **Active Scenario ID:** `nclex_poc_laparotomy_v3` (*Post-Exploratory Laparotomy Deterioration: Opioid Respiratory Depression & Postoperative Hemorrhage*)
- **Frontend Stack:** Next.js 14 (`frontend/`), React Three Fiber / Three.js WebGL, CORS-enabled Next.js Serverless API routes (`frontend/app/api/*`)
- **Python Reference Engine:** FastAPI (`backend-mock/main.py`, 1:1 parity with Next.js Serverless routes)

---

## 1. API Endpoints Summary

Let `<SIM_BASE_URL>` be the deployed Next.js simulation origin (e.g., `https://sim.studyai.pro` or `http://localhost:3000`) — or `http://localhost:8000` when running the standalone FastAPI engine (`backend-mock/main.py`). **Both services expose the exact same endpoints and JSON contracts:**

| Method & Endpoint | Description | Consumer |
|---|---|---|
| `GET /api/health` | Liveness & active scenario version probe (`{ status: "ok", service, version, scenario_id }`). | Load balancer / CI / StudyAI Backend |
| `GET /api/scenario` | Returns the authoritative `scenario_hypoxia.json` config, 7 bedside stations, 3 in-station NCLEX cue checks, 3 exit escalation questions, clinical trap penalties, and RN-vetted answer keys/rationales. | StudyAI Backend (DB sync / CMS ingestion) |
| `GET /api/evaluate` | Evaluation engine health check (`200 OK` + CORS preflight `OPTIONS 204`). | StudyAI Backend / Uptime check |
| `POST /api/evaluate` | Stateless scoring endpoint. Accepts `TelemetryPayload` and returns `EvaluationResult` across StudyAI's 4 diagnostic domains (`0–100`), 8 NCLEX Client-Needs categories, NCJMM layers, chronological `decision_tree`, and `adaptive_followup_question`. | 3D Client (`telemetryEmitter.js`) or StudyAI Backend |
| `POST <callback_url>` *(Outbound Webhook)* | When `callback_url` is supplied via query param or `NEXT_PUBLIC_PLATFORM_CALLBACK_URL`, the client automatically `POST`s `{ payload, evaluation }` upon completion. | StudyAI Backend |

> **Candidate UI Cleanliness Note:** All developer/PoC debug overlays (including the `Raw JSON telemetry` tab, raw JSON `<pre>` dumps, header FPS counters, and internal physiological event strings in the dock) are hidden from students. Raw structured telemetry is transmitted strictly over the API/webhook/`postMessage` channels below.

---

## 2. Launching the 3D Simulation from StudyAI (`GET /`)

Redirect the student to the simulation URL or embed it inside an `<iframe allow="autoplay; fullscreen">`:

```text
https://<SIM_BASE_URL>/?autostart=1&session_id=sess_99281&student_id=usr_4410&student_name=Chidinma%20Okafor&callback_url=https%3A%2F%2Fapi.studyai.pro%2Fv1%2Fassessments%2F3d-complete&return_url=https%3A%2F%2Fapp.studyai.pro%2Fdashboard
```

### Supported Launch Query Parameters

| Parameter | Required | Behavior |
|---|---|---|
| `autostart=1` *(or `skip_intro=1`, `entry=direct`)* | Recommended | Skips the standalone `BriefingModal` intro screen (when StudyAI's main app already showed the intro) and starts the timed `05:00` (`300s`) 3D bedside assessment immediately. Omit `autostart=1` for standalone full-flow demos. |
| `session_id` | Optional | Injected into `payload.session_id` and `evaluation.session_id`. Auto-generated (`ngn_<id>`) if omitted. |
| `student_id` | Optional | Injected into `payload.student_id` and `evaluation.student_id`. |
| `student_name` | Optional | Personalizes the StudyAI shell profile and Gap Chart header (`"Your gap chart, <FirstName>"`). |
| `callback_url` | Optional | URL-encoded StudyAI backend webhook URL receiving `POST { payload, evaluation }` as soon as evaluation finishes. |
| `return_url` | Optional | URL-encoded StudyAI dashboard URL; renders the primary **"Return to StudyAI dashboard"** CTA on the Gap Chart screen. |

---

## 3. Environment Variables & Deployment Modes

### Mode A — Single Deployment on Vercel / Docker (`frontend/` only, Zero-Config)
Set Vercel **Root Directory** to `frontend`. No environment variables are required out of the box—the Next.js app serves both the 3D WebGL room and the serverless `/api/health`, `/api/scenario`, and `/api/evaluate` routes with CORS enabled.

Optional `frontend/.env.production` variables:
```env
# Optional: route POST /api/evaluate directly to StudyAI's main backend or FastAPI service instead of Next.js /api/evaluate
NEXT_PUBLIC_AI_BACKEND_URL=https://api.studyai.pro/v1/nclex/evaluate

# Optional: default webhook URL if `callback_url` is not passed in the query string
NEXT_PUBLIC_PLATFORM_CALLBACK_URL=https://api.studyai.pro/v1/assessments/3d-complete
```

### Mode B — Standalone Python FastAPI Evaluation Service (`backend-mock/`)
If StudyAI ingests or hosts the scoring engine inside your Python backend stack:
```bash
cd backend-mock
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```
- Swagger / OpenAPI schema: `http://localhost:8000/docs`
- Point frontend to FastAPI: `NEXT_PUBLIC_AI_BACKEND_URL=http://localhost:8000/api/evaluate`

---

## 4. Endpoint Contracts & Schemas

### 4.1 `GET /api/health`
```json
{
  "status": "ok",
  "service": "StudyAI NCLEX-RN 3D Simulation & NGN Evaluation Engine",
  "version": "3.0",
  "scenario_id": "nclex_poc_laparotomy_v3"
}
```

### 4.2 `GET /api/scenario` (Authoritative Scenario & Answer Key Sync)
Returns the full scenario configuration (`frontend/config/scenario_hypoxia.json`) plus a pre-flattened `answer_key_summary` for database seeding:
- **`mandatory_bedside_safety_checks`**: `POWER_ON_MONITOR`, `VERIFY_PATIENT_ID`, `RAISE_SIDE_RAILS`, `REVIEW_EHR_TAB` (`mar`, `allergies`, `notes`, `labs`), `FLAG_ALLERGY`
- **`priority_clinical_interventions`**: `PAUSE_PCA`, `SET_BED_FOWLERS` (`>= 30°`), `ADMINISTER_O2`, `ASSESS_JP_HEMORRHAGE`, `INITIATE_CRYSTALLOID_BOLUS`, `VERIFY_GTUBE`
- **`clinical_traps_penalized`**:
  - `ALLERGY_CROSS_SENSITIVITY_ERROR` (`-40` Risk Recognition, **Critical Safety Event**)
  - `OPIOID_DEMAND_BOLUS_TRAP` (`-30` Risk Recognition, **Critical Safety Event**)
  - `SALINE_FLUSH_TRAP` (`-20` Risk Recognition)
  - `REMOVE_PRIMARY_DRESSING_TRAP` (`-20` Risk Recognition)
  - `TRENDELENBURG_TRAP` (`-20` Prioritisation)
  - `LEAVE_JP_OPEN_TRAP` (`-15` Risk Recognition)
  - `CONTINUE_BASAL_TRAP` (`-15` Risk Recognition)
- **`station_questions`** (`3` items): `sq_monitor_cues` (`B`), `sq_ehr_cross_check` (`B`), `sq_surgical_wound` (`B`)
- **`exit_questions`** (`3` items): `q1_sbar` (`B`), `q2_abg` (`C`), `q3_hemorrhage_jp` (`B`)

---

### 4.3 `POST /api/evaluate` — Request Schema (`TelemetryPayload`)

```json
{
  "session_id": "sess_99281",
  "scenario_id": "nclex_poc_laparotomy_v3",
  "student_id": "usr_4410",
  "exam_mode": "NGN_EXAM_READINESS",
  "research_scenario_mapping": [
    "SCENARIO_1_POSTOP_DETERIORATION",
    "SCENARIO_2_MED_ADVERSE_REACTION",
    "SCENARIO_5_IMPAIRED_OXYGENATION"
  ],
  "time_limit_sec": 300,
  "total_scenario_time_sec": 178.4,
  "end_reason": "STUDENT_CONCLUDED",
  "stabilized_at_end": true,
  "safety_checks": {
    "monitor_powered_on": true,
    "vitals_documented": true,
    "wristband_verified": true,
    "side_rails_raised": true,
    "rails_raised_count": 2,
    "jp_hemorrhage_assessed": true,
    "gtube_verified": true,
    "crystalloid_bolus_started": true,
    "mar_reviewed": true,
    "allergies_reviewed": true,
    "notes_reviewed": true,
    "labs_reviewed": true,
    "allergy_flagged": true,
    "cefazolin_status": "HELD",
    "naloxone_doses": 0,
    "paused_morphine_pca_infusion": true
  },
  "action_timeline": [
    {
      "step": 1,
      "timestamp_sec": 0,
      "action": "BEGIN_TIMED_ASSESSMENT",
      "label": "Timed bedside assessment started",
      "classification": "SYSTEM",
      "detail": "Time limit 05:00",
      "monitor_on": false,
      "vitals_snapshot": { "spo2": 88, "hr": 118, "rr": 10, "etco2": 56 }
    },
    {
      "step": 2,
      "timestamp_sec": 9.4,
      "action": "POWER_ON_MONITOR",
      "label": "Powered on bedside monitor & applied leads",
      "classification": "ASSESSMENT",
      "object_id": "bedside_monitor",
      "station_label": "Bedside Monitor",
      "diagnostic_domain": "knowledge",
      "ncjmm_phase": "RECOGNIZE_CUES",
      "detail": "SpO2 88%, HR 118, BP 92/58, RR 10, EtCO2 56",
      "monitor_on": true,
      "vitals_snapshot": { "spo2": 88, "hr": 118, "rr": 10, "etco2": 56 }
    }
  ],
  "traps_triggered": [],
  "station_question_responses": [
    { "question_id": "sq_monitor_cues", "selected_option_id": "B" },
    { "question_id": "sq_ehr_cross_check", "selected_option_id": "B" },
    { "question_id": "sq_surgical_wound", "selected_option_id": "B" }
  ],
  "exit_question_responses": [
    { "question_id": "q1_sbar", "selected_option_id": "B" },
    { "question_id": "q2_abg", "selected_option_id": "C" },
    { "question_id": "q3_hemorrhage_jp", "selected_option_id": "B" }
  ],
  "final_room_state": {
    "bed_angle_deg": 30,
    "left_rail_up": true,
    "right_rail_up": true,
    "side_rails_up": true,
    "o2_device": "non_rebreather",
    "pca_paused": true,
    "jp_assessed": true,
    "gtube_verified": true,
    "crystalloid_bolus": true,
    "hemorrhage_shock": false,
    "opioid_state": "baseline",
    "monitor_powered_on": true,
    "stations_inspected": [
      "bedside_monitor",
      "wristband",
      "ehr_tablet",
      "iv_pump",
      "hospital_bed",
      "wall_oxygen",
      "surgical_site"
    ],
    "vitals": { "hr": 88, "spo2": 97, "bp": "114/70", "rr": 16, "etco2": 40 }
  }
}
```

---

### 4.4 `POST /api/evaluate` — Response Schema (`EvaluationResult`)

```json
{
  "session_id": "sess_99281",
  "student_id": "usr_4410",
  "scenario_id": "nclex_poc_laparotomy_v3",
  "exam_mode": "NGN_EXAM_READINESS",
  "evaluated_at": "2026-11-25T22:15:00.000Z",
  "engine": "Study AI NGN Evaluation Engine v3.1 (Next.js Serverless /api/evaluate)",
  "overall_competency_score": 100,
  "readiness_band": {
    "level": "HIGH",
    "label": "HIGH LIKELIHOOD OF PASSING",
    "detail": "Performance is consistently above the passing standard."
  },
  "end_reason": "STUDENT_CONCLUDED",
  "end_reason_text": "You concluded bedside care and escalated to the surgical team.",
  "time_used_sec": 178.4,
  "time_limit_sec": 300,
  "stabilized_at_end": true,
  "critical_safety_events": [],
  "total_critical_actions": 8,
  "missed_critical_actions": [],
  "diagnostic_breakdown": {
    "knowledge": {
      "score": 100,
      "ncsbn_domain": "Physiological Adaptation (11-17%)",
      "status": "STRONG",
      "findings": [{ "points": 15, "text": "..." }]
    },
    "prioritisation": {
      "score": 100,
      "ncsbn_domain": "Management of Care (15-21%)",
      "status": "STRONG",
      "findings": [{ "points": 20, "text": "..." }]
    },
    "risk_recognition": {
      "score": 100,
      "ncsbn_domain": "Safety & Infection Control (10-16%) / Pharmacological & Parenteral Therapies (13-19%)",
      "status": "STRONG",
      "findings": [{ "points": 25, "text": "..." }]
    },
    "clinical_judgment": {
      "score": 100,
      "ncsbn_domain": "NCJMM 6-Layer Synthesis • Reduction of Risk Potential (9-15%)",
      "status": "STRONG",
      "findings": [{ "points": 35, "text": "..." }]
    }
  },
  "ncjmm_layers_demonstrated": [
    "RECOGNIZE_CUES",
    "ANALYZE_CUES",
    "PRIORITIZE_HYPOTHESES",
    "GENERATE_SOLUTIONS",
    "TAKE_ACTION",
    "EVALUATE_OUTCOMES"
  ],
  "recommended_practice_topics": [
    "Maintain readiness: practice a new NGN case type (e.g., acute blood transfusion reaction or septic shock)"
  ],
  "station_questions": ["...3 graded in-station cue check items with rationales..."],
  "exit_questions": ["...3 graded post-bedside escalation items with rationales..."],
  "adaptive_followup_question": {
    "question_id": "adaptive_renarcotization_monitoring",
    "ncsbn_category": "Reduction of Risk Potential / Physiological Adaptation",
    "prompt": "...",
    "options": ["..."],
    "correct_option_index": 0,
    "rationale": "..."
  },
  "decision_tree": ["...chronological action steps with vitals_snapshot & score_impact..."],
  "traps_triggered": []
}
```

---

## 5. Receiving Completion Events in StudyAI Frontend / Backend

1. **Webhook Callback (`callback_url`):**
   `POST <callback_url>` with JSON body `{ "payload": TelemetryPayload, "evaluation": EvaluationResult }`.
2. **Iframe `postMessage` Listener (when embedded inside StudyAI web app):**
   ```js
   window.addEventListener('message', (event) => {
     if (event.data?.type === 'STUDYAI_SIMULATION_COMPLETE') {
       const { payload, evaluation } = event.data;
       // Persist to StudyAI DB & unlock Question Bank / Adaptive Study Plan
     }
   });
   ```

---

## 6. Static 3D & Clinical Media Assets (`frontend/public/`)

Ensure CDN / static hosting serves `frontend/public/` with standard `Accept-Ranges: bytes` (automatic on Vercel, CloudFront, and Nginx) for smooth video streaming and GLB caching:
- **3D Models (`/models/*.glb`):** `hospital_bed_carlos.glb`, `patient.glb`, `nurse_daniel.glb`, `heart_monitor.glb`, `iv_pole.glb`, `ventilator.glb`, `pillow.glb`
- **Live-Action Clinical Observation Media (`/clinical-media/*`):**
  - `hypoxia_distress_deterioration.mp4` (`1080p` `24 fps` live-action patient diaphoresis & respiratory distress clip) + `hypoxia_distress_poster.jpg`
  - Surgical abdominal / JP drain assessment clips referenced in `scenario_hypoxia.json` (`exam_config.surgical_site`)

---

## 7. Quick `curl` Smoke Tests for Seun

```bash
# 1. Health probe
curl -s http://localhost:3000/api/health

# 2. Fetch scenario + RN answer key
curl -s http://localhost:3000/api/scenario

# 3. Score a minimal test submission
curl -s -X POST http://localhost:3000/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "smoke_test_01",
    "scenario_id": "nclex_poc_laparotomy_v3",
    "student_id": "seun_test",
    "total_scenario_time_sec": 145,
    "end_reason": "STUDENT_CONCLUDED",
    "stabilized_at_end": true,
    "safety_checks": {
      "monitor_powered_on": true,
      "wristband_verified": true,
      "side_rails_raised": true,
      "mar_reviewed": true,
      "allergies_reviewed": true,
      "notes_reviewed": true,
      "labs_reviewed": true,
      "allergy_flagged": true,
      "jp_hemorrhage_assessed": true
    },
    "action_timeline": [
      {"step": 1, "timestamp_sec": 8, "action": "POWER_ON_MONITOR"},
      {"step": 2, "timestamp_sec": 18, "action": "VERIFY_PATIENT_ID"},
      {"step": 3, "timestamp_sec": 25, "action": "RAISE_SIDE_RAILS"},
      {"step": 4, "timestamp_sec": 40, "action": "PAUSE_PCA"},
      {"step": 5, "timestamp_sec": 52, "action": "SET_BED_FOWLERS"},
      {"step": 6, "timestamp_sec": 64, "action": "ADMINISTER_O2"},
      {"step": 7, "timestamp_sec": 82, "action": "ASSESS_JP_HEMORRHAGE"},
      {"step": 8, "timestamp_sec": 95, "action": "INITIATE_CRYSTALLOID_BOLUS"}
    ],
    "station_question_responses": [
      {"question_id": "sq_monitor_cues", "selected_option_id": "B"},
      {"question_id": "sq_ehr_cross_check", "selected_option_id": "B"},
      {"question_id": "sq_surgical_wound", "selected_option_id": "B"}
    ],
    "exit_question_responses": [
      {"question_id": "q1_sbar", "selected_option_id": "B"},
      {"question_id": "q2_abg", "selected_option_id": "C"},
      {"question_id": "q3_hemorrhage_jp", "selected_option_id": "B"}
    ],
    "final_room_state": {
      "bed_angle_deg": 30,
      "side_rails_up": true,
      "o2_device": "non_rebreather",
      "pca_paused": true,
      "jp_assessed": true,
      "gtube_verified": true,
      "crystalloid_bolus": true,
      "vitals": {"spo2": 97, "hr": 88, "rr": 16}
    }
  }'
```
