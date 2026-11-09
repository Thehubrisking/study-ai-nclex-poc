# Study AI — NCLEX-RN 3D Simulation & Diagnostic Telemetry Rules (GEMINI.md)

## 1. Project Context & Scope Guardrails
- **Product:** Study AI NCLEX-RN Clinical Judgment Simulation Prototype (Single-Scenario PoC).
- **Architecture:** Hybrid **Deterministic Visual/UI Layer** (Next.js + React Three Fiber + `@react-three/drei` + 2D EHR Overlays) + **Probabilistic AI Evaluation Layer** (Python FastAPI backend on port 8000).
- **Single-Scenario Scope:** Strictly bounded to 1 hospital room environment and 6 interactive clinical objects driven by `frontend/config/scenario_hypoxia.json`. All clinical values (vitals, MAR, notes, labs, alternative scenario presets) must remain decoupled in JSON so the Clinical Lead / Nurse Practitioner can edit parameters without modifying 3D code.

## 2. NCSBN 2026 Test Plan & Research Synthesis
Our primary reference scenario (`nclex_poc_hypoxia_01`) synthesizes three high-priority scenarios from the Study AI Clinical Scenario Research (`NCLEX_MVP.docx`):
1. **Scenario #1:** Postoperative patient deterioration (*Reduction of Risk Potential*, 9–15%)
2. **Scenario #2:** Medication adverse reaction — IV Morphine PCA (*Pharmacological and Parenteral Therapies*, 13–19%)
3. **Scenario #5:** Respiratory distress / impaired oxygenation (*Physiological Adaptation*, 11–17%)
- Also incorporates **Kaplan Priority & Safety Strategies** (Maslow's ABCs, Wristband ID check, Allergy check) and **Simple Nursing Core 3** (Pharmacology, Med-Surg, Priority Care).

## 3. Study AI's 4 Mandatory Diagnostic Categories
Every telemetry payload (`frontend/utils/telemetryEmitter.js`) and evaluation response (`backend-mock/main.py`) MUST evaluate and group learner performance into the 4 diagnostic domains defined in the Study AI NCLEX-RN Project Scope:
1. `knowledge` (Inspection of vitals monitor & 2D EHR tabs)
2. `prioritisation` (Chronological order of Maslow/ABC actions: Bed elevation -> O2 administration)
3. `risk_recognition` (Patient ID wristband verification, allergy check, pausing Morphine PCA pump)
4. `clinical_judgment` (NCJMM 6-layer synthesis & adaptive follow-up question performance)

## 4. Technical Execution Rules for Antigravity Agents
- Keep 3D meshes clean, modular, and responsive (`@react-three/fiber` + `@react-three/drei` `<Html>` tags for crisp 2D clinical labels).
- Client-side physiological feedback must update in `<100ms` (e.g., elevating bed from 0° to 60° High Fowler's increases SpO2 from 88% to 91%; applying O2 increases SpO2 to 96%).
- Do not hardcode clinical text inside JSX components; read all patient data, vitals, EHR tabs, and alternative presets from `frontend/config/scenario_hypoxia.json`.
