# StudyAI NCLEX-RN 3D Simulation — RN SME Answer Key & Clinical Sign-Off Sheet

- **Scenario ID:** `nclex_poc_laparotomy_v3` (`v3.1`)
- **Clinical Title:** Post-Exploratory Laparotomy: Opioid Respiratory Depression, Postoperative Hemorrhage & Wound Complication Risk
- **Prepared For:** Joe Vener Cabaltera, RN (Clinical SME) & Yvonne Momah
- **Source Truth File:** `frontend/config/scenario_hypoxia.json` (`GET /api/scenario`)

---

## 1. Patient Handoff & Baseline Physiology

| Parameter | Value / Clinical Cue | NCLEX Teaching Point |
|---|---|---|
| **Patient** | John Doe, 62M, DOB `1963-09-14`, MRN `MRN-88412` | Two-identifier wristband check required before interventions |
| **Procedure** | 4 hours post-exploratory laparotomy for small-bowel obstruction | High risk for surgical-site bleeding, dehiscence/evisceration, and opioid hypoventilation |
| **Drains & Tubes** | RLQ Jackson-Pratt (JP) closed-suction bulb drain + LUQ Gastrostomy (G-tube) + Midline laparotomy gauze with sanguineous strikethrough | Correlate surgical drain output (`135 mL/hr` bright-red blood) with hemodynamic instability |
| **Initial Telemetry** | `SpO2 88%` · `RR 10/min` · `HR 122 bpm` · `BP 92/58 mmHg` · `EtCO2 54 mmHg` · `Temp 36.6°C` | Dual pathology: **Opioid Respiratory Depression** (`RR 10`, `SpO2 88%`, `EtCO2 54`) + **Postoperative Hemorrhage** (`HR 122`, `BP 92/58`, pallor, cool clammy diaphoresis) |
| **Lab Trend** | Pre-op `Hgb 13.4 g/dL` (`Hct 40%`) → PACU `Hgb 9.6 g/dL` (`Hct 29%`); ABG `pH 7.28`, `PaCO2 55`, `PaO2 62`, `HCO3 24` | Acute `3.8 g/dL` hemoglobin drop + uncompensated respiratory acidosis |
| **Allergy Alert** | **Penicillin — Anaphylaxis** (Cefazolin `1 g IV` due now on MAR) | Hold Cefazolin and clarify with prescriber due to cephalosporin cross-sensitivity risk |

---

## 2. Mandatory Open-World Bedside Actions & Clinical Traps

### Expected Priority Actions (8 Scored Bedside Cues)
1. **Power on Bedside Monitor (`POWER_ON_MONITOR`)** — Establish objective telemetry baseline (`SpO2 88%`, `HR 122`, `BP 92/58`, `RR 10`).
2. **Verify Patient Wristband (`VERIFY_PATIENT_ID`)** — Confirm two identifiers (`John Doe` + `1963-09-14`) prior to administering O2, IV fluids, or medications.
3. **Raise & Lock Bed Side Rails (`RAISE_SIDE_RAILS`)** — Raise the lowered upper-left transfer rail to prevent falls in a sedated, hypotensive post-op patient.
4. **Review EHR & Flag Penicillin Allergy (`REVIEW_EHR_TAB` + `FLAG_ALLERGY` + `CEFAZOLIN_HELD_ALLERGY`)** — Review MAR, Allergies, Notes, and Labs; flag Penicillin anaphylaxis and hold Cefazolin `1 g IV`.
5. **Pause Morphine PCA Infusion (`PAUSE_PCA`)** — Stop continuous `2 mg/hr` Morphine infusion driving `RR 10/min`.
6. **Elevate Head of Bed (`SET_BED_FOWLERS`)** — Place in Semi-Fowler's (`30°`, knees slightly flexed) to improve diaphragmatic excursion without straining the laparotomy suture line.
7. **Apply Supplemental Oxygen (`ADMINISTER_O2`)** — Initiate PRN oxygen (`Nasal Cannula 4 L/min`, `Simple Mask 8 L/min`, or `Non-Rebreather 15 L/min`).
8. **Assess JP Drain, Re-Compress Bulb & Reinforce Dressing + Start NS Bolus (`ASSESS_JP_HEMORRHAGE` + `INITIATE_CRYSTALLOID_BOLUS`)** — Measure `135 mL/hr` sanguineous output, compress the JP bulb flat before recapping to restore negative suction, reinforce **over** the blood-stained primary gauze, verify LUQ G-tube (`VERIFY_GTUBE`), and start PRN `0.9% Normal Saline 500 mL` IV bolus via secondary port.

### Penalized Clinical Traps & Branching Escalations
- **`ALLERGY_CROSS_SENSITIVITY_ERROR` (`-40` Risk Recognition, Critical Safety Event):** Administering Cefazolin `1 g IV` without flagging Penicillin anaphylaxis.
- **`OPIOID_DEMAND_BOLUS_TRAP` (`-30` Risk Recognition, Critical Safety Event):** Administering an extra `1 mg` Morphine PCA bolus to a bradypneic, hypotensive patient.
- **`SALINE_FLUSH_TRAP` (`-20` Risk Recognition):** Rapid normal-saline push through the Morphine PCA line, bolusing residual narcotic in tubing.
- **`REMOVE_PRIMARY_DRESSING_TRAP` (`-20` Risk Recognition):** Peeling off the surgeon's primary laparotomy dressing `<24 hr` post-op during active bleeding instead of reinforcing over it.
- **`TRENDELENBURG_TRAP` (`-20` Prioritisation):** Placing the post-laparotomy patient at `-15°` head-down, pushing abdominal viscera against the diaphragm.
- **`CONTINUE_BASAL_TRAP` (`-15` Risk Recognition):** Leaving the `2 mg/hr` Morphine basal infusion running (triggers **Branch B: Opioid Masking Crash** -> `RR 7/min`, `EtCO2 64`, requiring **Naloxone `0.4 mg` IV push**).
- **Branch D (`UNRECOGNIZED_HEMORRHAGE_ESCALATION` at `90s`):** Leaving the `135 mL/hr` sanguineous JP drain and hypotension unaddressed escalates into decompensated hypovolemic shock (`HR 136 bpm`, `BP 78/46 mmHg`, worsening pallor & diaphoresis).

---

## 3. In-Station Bedside NCLEX Cue Questions (3 Items)

### `sq_monitor_cues` — Bedside Telemetry Monitor (`Physiological Adaptation`)
- **Stem:** The monitor shows `HR 122 bpm`, `BP 92/58 mmHg`, `RR 10/min`, and `SpO2 88%` in a pale, diaphoretic post-laparotomy patient on a Morphine PCA. Which concurrent complications explain this pattern?
- **Options:**
  - `A`: Normal post-anesthesia shivering with benign emergence hypertension.
  - **`B` (CORRECT KEY):** Opioid-induced respiratory depression (`RR 10/min`, `SpO2 88%`) alongside suspected postoperative hemorrhage / hypovolemia (tachycardia, hypotension, pallor, diaphoresis).
  - `C`: Fluid volume overload from intraoperative IV crystalloid administration.
  - `D`: Malignant hyperthermia requiring immediate dantrolene IV push.
- **Rationale:** `RR < 12/min` with `SpO2 88%` on continuous Morphine PCA indicates opioid-induced respiratory depression, while compensatory tachycardia (`HR 122`), hypotension (`BP 92/58`), pallor, and diaphoresis are classic manifestations of postoperative hemorrhage after an exploratory laparotomy.
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `sq_ehr_cross_check` — Bedside EHR & MAR (`Pharmacological and Parenteral Therapies`)
- **Stem:** Pre-op Hgb was `13.4 g/dL` and PACU Hgb is now `9.6 g/dL`; Cefazolin `1 g IV` is due now; Allergies list Penicillin (Anaphylaxis). Which nursing decision is safest?
- **Options:**
  - `A`: Administer Cefazolin `1 g IV` immediately to prevent surgical infection, then recheck Hgb in 24 hours.
  - **`B` (CORRECT KEY):** Hold Cefazolin due to cephalosporin cross-sensitivity risk with anaphylactic penicillin allergy, prepare PRN Naloxone, and correlate the `3.8 g/dL` Hgb drop with bedside JP drain output.
  - `C`: Administer half the Cefazolin dose slowly over 60 minutes without notifying the prescriber.
  - `D`: Increase the Morphine PCA basal rate to blunt sympathetic tachycardia.
- **Rationale:** First-generation cephalosporins (cefazolin) carry a cross-reactivity risk in patients with severe IgE-mediated penicillin anaphylaxis and must be held for prescriber clarification. Simultaneously, an acute Hgb drop from `13.4` to `9.6 g/dL` confirms significant blood loss requiring immediate surgical drain correlation.
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `sq_surgical_wound` — Surgical Dressing & Drains (`Reduction of Risk Potential`, Figure 31-2B)
- **Stem:** If this post-laparotomy patient coughs forcefully and loops of pink bowel protrude through the separated abdominal suture line (wound evisceration), what is your IMMEDIATE priority action?
- **Options:**
  - `A`: Use sterile gloved fingers to gently push the protruding bowel loops back into the peritoneal cavity.
  - `B`: Place the patient in High Fowler's (`90°`) and wrap a dry elastic abdominal binder tightly over the wound.
  - **`C` (CORRECT KEY):** Place the patient in Low Fowler's (`15–20°`) with knees flexed, cover the protruding organs with sterile gauze moistened with warm sterile `0.9%` Normal Saline, keep NPO, and notify the surgeon STAT.
  - `D`: Leave the eviscerated bowel exposed to air and collect a wound swab for culture.
- **Rationale:** Wound evisceration is a surgical emergency: Low Fowler's with knees bent relieves tension on the abdominal incision, sterile warm saline-soaked dressings keep extruded viscera moist and prevent tissue necrosis (never push organs back in or apply dry gauze), and the surgical team must be notified STAT for operative repair.
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

---

## 4. Post-Simulation Exit Questions (4 Items)

### `q1_sbar` — Question 1 of 4 • SBAR Surgical Escalation (`Management of Care`)
- **Stem:** You call the surgical resident regarding John Doe (4 hours post-exploratory laparotomy). Which SBAR report is most accurate and clinically complete?
- **Approved Key:** **`B`** — *"S: John Doe, 62, 4 h post-exploratory laparotomy, presenting with opioid respiratory depression AND suspected postoperative hemorrhage. B: Morphine PCA 2 mg/hr, Hgb dropped 13.4 → 9.6 g/dL, anaphylactic penicillin allergy (Cefazolin held). A: Pale, diaphoretic, HR 122, BP 92/58, RR 10, SpO2 88%, JP drain 135 mL/hr bright-red blood with gauze strikethrough; PCA paused, O2 & Semi-Fowler's applied, dressing reinforced, NS bolus started. R: Please evaluate at bedside STAT for active bleeding, review analgesia, and clarify antibiotic prophylaxis."*
- **Distractors:** `A` (requests increasing Morphine PCA), `C` (peeled off primary surgical gauze & requests no orders), `D` (gave Cefazolin despite Penicillin anaphylaxis & left PCA running).
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `q2_abg` — Question 2 of 4 • ABG & Opioid Reversal (`Pharmacological and Parenteral Therapies`)
- **Stem:** An arterial blood gas drawn during the episode shows: `pH 7.28`, `PaCO2 55 mmHg`, `PaO2 62 mmHg`, `HCO3 24 mEq/L`. The patient is difficult to arouse with `RR 9/min`. Which interpretation and nursing action are most appropriate?
- **Approved Key:** **`C`** — *"Uncompensated respiratory acidosis — administer naloxone 0.4 mg IV per PRN order, keep the Morphine PCA paused, and monitor closely for renarcotization."*
- **Distractors:** `A` (metabolic acidosis / sodium bicarbonate), `B` (increase morphine PCA), `D` (compensated respiratory alkalosis / paper-bag breathing).
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `q3_hemorrhage_jp` — Question 3 of 4 • Postoperative Hemorrhage & JP Drain Cues (`Reduction of Risk Potential`)
- **Stem:** Which cluster of assessment findings in a patient 4 hours after an exploratory laparotomy most strongly indicates active internal postoperative hemorrhage requiring immediate surgical intervention?
- **Approved Key:** **`B`** — *"Tachycardia (HR 122–136 bpm), hypotension (BP 92/58 → 78/46 mmHg), pallor, cool clammy diaphoresis, restlessness, and >100 mL/hr bright-red sanguineous JP drain output."*
- **Distractors:** `A` (normal vitals + 20 mL serosanguineous over 4 hr), `C` (low-grade 37.3°C temp + 40 mL bilious G-tube return), `D` (Cushing-like bradycardia/hypertension).
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `q4_dehiscence_evisceration` — Question 4 of 4 • Wound Dehiscence & Evisceration Emergency (`Physiological Adaptation`)
- **Stem:** If the patient suddenly feels "something give way" at his laparotomy incision after coughing, followed by a gush of pink serosanguineous fluid and protrusion of bowel loops through the separated wound edges (evisceration), which sequence of actions must the nurse take?
- **Approved Key:** **`A`** — *"Place in Low Fowler's (15–20°) with knees flexed, cover protruding bowel with sterile dressings soaked in warm sterile 0.9% Normal Saline, maintain NPO, stay with the patient, and have a colleague notify the surgeon STAT."*
- **Distractors:** `B` (Trendelenburg + dry gauze manual re-insertion + morphine), `C` (ambulate patient to treatment room), `D` (irrigate bowel with cytotoxic povidone-iodine + occlusive film).
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`
