# Study AI — NCLEX-RN 3D Clinical Judgment Simulation (PoC v3.0)

Interactive 3D Next-Generation NCLEX (NGN) bedside simulation and diagnostic evaluation engine for **Case 01: Acute Post-Operative Hypoxia & Opioid-Induced Respiratory Depression** (`NCLEX_RN_MEDSURG_POSTOP_HYPOXIA_001`).

Built for **Yvonne** (Clinical Lead) and **Oluwaseun** (Backend / AI Systems Lead).

---

## 1. Repository Structure

```text
study_ai_poc_starter_v2/
├── GEMINI.md                                # Architectural & clinical decoupling rules
├── README.md                                # Stakeholder & Backend Handover Guide (this file)
├── backend-mock/
│   ├── main.py                              # Standalone Python FastAPI Evaluation Engine (:8000)
│   └── requirements.txt                     # FastAPI, Uvicorn, Pydantic dependencies
└── frontend/
    ├── config/
    │   └── scenario_hypoxia.json            # Single source of truth for all clinical copy, vitals, traps & answer keys
    ├── app/
    │   ├── page.jsx                         # Main NGN 4-stage exam orchestrator & responsive HUD
    │   ├── layout.jsx                       # Viewport & metadata config (mobile/tablet safe-area ready)
    │   ├── globals.css                      # Liquid-glass design system & responsive mobile/tablet rules
    │   └── api/
    │       └── evaluate/
    │           └── route.js                 # Built-in Next.js Serverless POST /api/evaluate route (Vercel ready)
    ├── components/
    │   ├── Room3D.jsx                       # Three.js / React Three Fiber 3D clinical room & nurse locomotion
    │   ├── AdaptiveQuality.jsx              # Dynamic DPR + post-processing EffectComposer resizer
    │   ├── DraggableGlassPanel.jsx          # Desktop floating drawer / Mobile docked bottom sheet
    │   ├── VitalsMonitorModal.jsx           # Real-time ECG, SpO2 pleth, Capnography waveforms
    │   └── exam/
    │       ├── BriefingModal.jsx            # Stage 1: Candidate pre-briefing modal
    │       ├── StationPanels.jsx            # Stage 2: Neutral exam-mode station inspection panels
    │       ├── ExitQuestionsModal.jsx       # Stage 3: SBAR escalation & ABG interpretation exit questions
    │       └── PerformanceReport.jsx        # Stage 4: 4-domain diagnostic report, decision tree & raw JSON tab
    ├── lib/
    │   ├── examEngine.js                    # Deterministic physiology & vital-sign trajectory engine
    │   ├── liveVitals.js                    # Beat-to-beat physiological jitter driver
    │   ├── navigation.js                    # 2D obstacle-avoiding waypoint navigation for the 3D nurse
    │   └── useViewport.js                   # Phone / Tablet / Touch viewport detection hook
    └── utils/
        ├── telemetryEmitter.js              # POSTs Payload 1 to NEXT_PUBLIC_AI_BACKEND_URL || "/api/evaluate"
        └── clinicalAudio.js                 # WebAudio synthesized ECG beep, alarms & bed servo hum
```

---

## 2. Running Locally & Deploying to Vercel

### Option A: Zero-Config Mode (Vercel & Local Next.js Serverless API)

By default, `frontend/utils/telemetryEmitter.js` sends telemetry to `process.env.NEXT_PUBLIC_AI_BACKEND_URL || "/api/evaluate"`.
When `NEXT_PUBLIC_AI_BACKEND_URL` is not set, Next.js handles `POST /api/evaluate` directly via `frontend/app/api/evaluate/route.js` using the exact same scoring rules as `backend-mock/main.py`.

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.
When deploying to **Vercel**, set the **Root Directory** to `frontend`. No environment variables are required for stakeholder review—clicking **`[Conclude Bedside Care & Escalate (SBAR)]`** and submitting the exit questions evaluates all 4 diagnostic domains immediately on desktop, tablet, or phone.

### Option B: Standalone Python FastAPI Backend Mode (For Oluwaseun)

To run the Python FastAPI evaluation engine on port `8000` and point the frontend to it:

1. **Start the FastAPI Server (`backend-mock/main.py`):**
   ```bash
   cd backend-mock
   pip install -r requirements.txt
   python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   - Health check: `GET http://localhost:8000/api/health`
   - Interactive OpenAPI / Swagger Docs: `http://localhost:8000/docs`

2. **Point the Frontend to FastAPI:**
   ```bash
   cd frontend
   NEXT_PUBLIC_AI_BACKEND_URL="http://localhost:8000/api/evaluate" npm run dev
   ```
   *(On Windows PowerShell: `$env:NEXT_PUBLIC_AI_BACKEND_URL="http://localhost:8000/api/evaluate"; npm run dev`)*

---

## 3. Clinical Content Guide (For Yvonne)

All clinical parameters, narrative text, distractors/traps, physiological trajectories, and exit-question answer keys live in **`frontend/config/scenario_hypoxia.json`**:

- **`patient`**: Demographics, MRN, DOB, allergies (`Penicillin (SEVERE — Anaphylaxis)`), and presenting status.
- **`initial_vitals` & `exam_config.physiology`**: Baseline vitals, target trajectories for each bed angle (`0°`, `30°`, `60°`), oxygen device (`nasal_cannula_2l`, `non_rebreather_15l`), PCA infusion state, and time-based clinical complications (`OPIOID_MASKING_BRADYPNEA`, `RENARCOTIZATION`, `CODE_BLUE_FAILURE`).
- **`ehr_tabs`**: Full text for `notes`, `labs`, `mar`, and `allergies`.
- **`exam_config.event_catalog`**: Every scored candidate action (`POWER_ON_MONITOR`, `VERIFY_PATIENT_ID`, `FLAG_ALLERGY`, `PAUSE_PCA`, `SET_BED_FOWLERS`, `ADMINISTER_O2`, `ADMINISTER_NALOXONE`) and clinical trap (`TRENDELENBURG_TRAP`, `OPIOID_DEMAND_BOLUS_TRAP`, `SALINE_FLUSH_TRAP`, `CONTINUE_BASAL_TRAP`, `ALLERGY_CROSS_SENSITIVITY_ERROR`) with its NCSBN/NCJMM rationale.
- **`exam_config.exit_questions`**: SBAR escalation (`q1_sbar`) and ABG interpretation (`q2_abg`) multiple-choice items, correct option IDs, and clinical rationales.

Both `backend-mock/main.py` and `frontend/app/api/evaluate/route.js` read directly from `frontend/config/scenario_hypoxia.json`, so edits to the JSON file take effect without modifying application code.

---

## 4. Telemetry & Evaluation API Contract (For Oluwaseun)

### Endpoint

- **Method:** `POST`
- **Path:** `/api/evaluate`
- **Content-Type:** `application/json`

---

### Payload 1 — Request Schema (`TelemetryPayload`)

Sent by `frontend/utils/telemetryEmitter.js` when the candidate completes the exit assessment:

```json
{
  "session_id": "ses_1794168000_x7k9m2",
  "scenario_id": "NCLEX_RN_MEDSURG_POSTOP_HYPOXIA_001",
  "student_id": "stu_4410",
  "exam_mode": "NGN_EXAM_READINESS",
  "research_scenario_mapping": [
    "SCENARIO_1_POSTOP_DETERIORATION",
    "SCENARIO_2_MED_ADVERSE_REACTION",
    "SCENARIO_5_IMPAIRED_OXYGENATION"
  ],
  "time_limit_sec": 300,
  "total_scenario_time_sec": 142,
  "end_reason": "STUDENT_CONCLUDED",
  "stabilized_at_end": true,
  "safety_checks": {
    "monitor_powered_on": true,
    "vitals_documented": true,
    "wristband_verified": true,
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
      "timestamp_sec": 8,
      "action": "POWER_ON_MONITOR",
      "label": "Powered on bedside telemetry monitor",
      "detail": "SpO2 88% • HR 112 • RR 8 • BP 104/66 • EtCO2 58",
      "station_id": "bedside_monitor",
      "station_label": "Bedside Monitor",
      "classification": "ASSESSMENT",
      "severity": null,
      "rationale": "Establishes objective baseline vital signs to recognize hypoxia and bradypnea cues.",
      "vitals_snapshot": {
        "hr": 112,
        "spo2": 88,
        "rr": 8,
        "bp": "104/66",
        "etco2": 58,
        "temp": "36.8°C"
      }
    },
    {
      "step": 2,
      "timestamp_sec": 24,
      "action": "VERIFY_PATIENT_ID",
      "label": "Verified patient ID wristband (two identifiers)",
      "detail": "John Doe • MRN-994821",
      "station_id": "wristband",
      "station_label": "Patient Wrist",
      "classification": "CORRECT",
      "severity": null,
      "rationale": "Confirms patient identity and reveals the red penicillin allergy band before any intervention.",
      "vitals_snapshot": {
        "hr": 112,
        "spo2": 88,
        "rr": 8,
        "bp": "104/66",
        "etco2": 58,
        "temp": "36.8°C"
      }
    }
  ],
  "traps_triggered": [],
  "exit_question_responses": [
    {
      "question_id": "q1_sbar",
      "selected_option_id": "B"
    },
    {
      "question_id": "q2_abg",
      "selected_option_id": "C"
    }
  ],
  "final_room_state": {
    "bed_angle_deg": 30,
    "o2_device": "non_rebreather_15l",
    "pca_paused": true,
    "opioid_state": "baseline",
    "monitor_powered_on": true,
    "stations_inspected": [
      "bedside_monitor",
      "wristband",
      "ehr_tablet",
      "iv_pump",
      "hospital_bed",
      "wall_oxygen"
    ],
    "vitals": {
      "hr": 86,
      "spo2": 97,
      "rr": 15,
      "bp": "118/74",
      "etco2": 41,
      "temp": "36.8°C"
    }
  }
}
```

---

### Payload 2 — Response Schema (`EvaluationResult`)

Returned by both `POST /api/evaluate` (`frontend/app/api/evaluate/route.js`) and `POST http://localhost:8000/api/evaluate` (`backend-mock/main.py`):

```json
{
  "session_id": "ses_1794168000_x7k9m2",
  "scenario_id": "NCLEX_RN_MEDSURG_POSTOP_HYPOXIA_001",
  "exam_mode": "NGN_EXAM_READINESS",
  "evaluated_at": "2026-11-09T15:55:00.000Z",
  "engine": "Study AI NGN Evaluation Engine v3.0 (Next.js Serverless /api/evaluate)",
  "overall_competency_score": 100,
  "readiness_band": {
    "level": "HIGH",
    "label": "HIGH LIKELIHOOD OF PASSING",
    "detail": "Performance is consistently above the passing standard."
  },
  "end_reason": "STUDENT_CONCLUDED",
  "end_reason_text": "You concluded bedside care and escalated to the surgical resident.",
  "time_used_sec": 142,
  "time_limit_sec": 300,
  "stabilized_at_end": true,
  "critical_safety_events": [],
  "diagnostic_breakdown": {
    "knowledge": {
      "score": 100,
      "ncsbn_domain": "Physiological Adaptation (11-17%)",
      "status": "STRONG",
      "findings": [
        { "points": 20, "text": "Powered on bedside telemetry (SpO2 + ECG) to establish a baseline." },
        { "points": 10, "text": "Documented the abnormal vital signs." },
        { "points": 15, "text": "Reviewed EHR MAR tab." },
        { "points": 15, "text": "Reviewed EHR ALLERGIES tab." },
        { "points": 10, "text": "Reviewed EHR NOTES tab." },
        { "points": 5, "text": "Reviewed EHR LABS tab." },
        { "points": 25, "text": "Correctly interpreted the ABG (uncompensated respiratory acidosis) and selected naloxone." }
      ]
    },
    "prioritisation": {
      "score": 100,
      "ncsbn_domain": "Management of Care (15-21%)",
      "status": "STRONG",
      "findings": [
        { "points": 25, "text": "Completed admission safety checks (monitor, ID, MAR, allergies) before intervening." },
        { "points": 15, "text": "Elevated the head of bed (Fowler's) to support lung expansion." },
        { "points": 5, "text": "Head of bed remained elevated at the end of the bedside phase." },
        { "points": 15, "text": "Initiated supplemental oxygen per the PRN order." },
        { "points": 5, "text": "Supplemental oxygen remained in place at the end of the bedside phase." },
        { "points": 10, "text": "First ABC intervention within 38s of recognizing the cues." },
        { "points": 25, "text": "Selected a complete, structured SBAR escalation with a specific recommendation." }
      ]
    },
    "risk_recognition": {
      "score": 100,
      "ncsbn_domain": "Safety & Infection Control (10-16%) / Pharmacological & Parenteral Therapies (13-19%)",
      "status": "STRONG",
      "findings": [
        { "points": 15, "text": "Verified the wristband with two identifiers." },
        { "points": 5, "text": "Patient identity confirmed before any intervention." },
        { "points": 15, "text": "Flagged the penicillin anaphylaxis allergy." },
        { "points": 30, "text": "Morphine PCA was paused (opioid source controlled)." },
        { "points": 10, "text": "Prevented progression to opioid toxicity." },
        { "points": 25, "text": "No critical safety events." }
      ]
    },
    "clinical_judgment": {
      "score": 100,
      "ncsbn_domain": "NCJMM 6-Layer Synthesis • Reduction of Risk Potential (9-15%)",
      "status": "STRONG",
      "findings": [
        { "points": 35, "text": "Patient met stabilization criteria at the end of the bedside phase (SpO2 ≥ 95%, RR ≥ 14, PCA paused)." },
        { "points": 10, "text": "Concluded bedside care and escalated within the time limit." },
        { "points": 15, "text": "SBAR escalation question correct." },
        { "points": 15, "text": "ABG follow-up question correct." },
        { "points": 25, "text": "Distractor avoidance: no clinical distractors selected (full credit)." }
      ]
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
  "missed_critical_actions": [],
  "recommended_practice_topics": [
    "Maintain readiness: practice a new NGN case type (e.g., transfusion reaction or sepsis)"
  ],
  "exit_questions": [
    {
      "question_id": "q1_sbar",
      "title": "Question 1 of 2 • SBAR Escalation to Surgical Resident",
      "ncsbn_category": "Management of Care • Collaboration with Interdisciplinary Team",
      "selected_option_id": "B",
      "correct_option_id": "B",
      "is_correct": true,
      "rationale": "Effective SBAR communication states the immediate clinical situation (acute hypoxia and bradypnea), relevant background (post-op laparotomy on basal + demand Morphine PCA), objective assessment (vitals and actions already taken), and a specific recommendation."
    },
    {
      "question_id": "q2_abg",
      "title": "Question 2 of 2 • Arterial Blood Gas & Pharmacology Synthesis",
      "ncsbn_category": "Physiological Adaptation & Pharmacological Therapies",
      "selected_option_id": "C",
      "correct_option_id": "C",
      "is_correct": true,
      "rationale": "pH 7.24 (< 7.35) with PaCO2 62 mmHg (> 45 mmHg) and normal HCO3- (25 mEq/L) defines acute uncompensated respiratory acidosis caused by opioid-induced hypoventilation."
    }
  ],
  "adaptive_followup_question": {
    "question_id": "adaptive_renarcotization_monitoring",
    "ncsbn_category": "Reduction of Risk Potential / Physiological Adaptation",
    "prompt": "Thirty minutes after stabilizing the patient and pausing the Morphine PCA, why must the nurse continue close respiratory and sedation monitoring (Pasero Opioid-Induced Sedation Scale)?",
    "options": [
      "Naloxone has a shorter biological half-life (30–90 min) than morphine, creating a risk of renarcotization and recurrent respiratory depression.",
      "Supplemental oxygen via Non-Rebreather permanently eliminates hypercapnia.",
      "Fowler’s position increases venous return to the right atrium and causes pulmonary edema.",
      "Cefazolin cross-reacts with opioid receptors after 30 minutes."
    ],
    "correct_option_index": 0,
    "rationale": "Because naloxone is metabolized faster than most opioids, sedation and respiratory depression can recur ('renarcotization') once the antagonist wears off."
  },
  "decision_tree": [],
  "traps_triggered": []
}
```
