# StudyAI NCLEX-RN 3D Simulation — RN SME Answer Key & Clinical Sign-Off Sheet

- **Scenario ID:** `nclex_poc_laparotomy_v3` (`v3.2`)
- **Clinical Title:** Day-0 Post-Exploratory Laparotomy: Opioid PCA Respiratory Depression & Postoperative Hemorrhage
- **Prepared For:** Joe Vener Cabaltera, RN (Clinical SME) & Yvonne Momah
- **Source Truth File:** `frontend/config/scenario_hypoxia.json` (`GET /api/scenario`)

---

## 1. Patient Handoff & Baseline Physiology (Spoiler-Free Bedside Discovery)

| Parameter | Value / Clinical Cue | NCLEX Teaching Point |
|---|---|---|
| **Patient** | John Doe, 62M, DOB `1963-09-14`, MRN `MRN-88412` | Two-identifier 3D barcode wristband check (+ rear crimson Penicillin allergy clasp) required before interventions |
| **Procedure** | 4 hours post-exploratory laparotomy for small-bowel obstruction | High risk for Day-0 surgical-site hemorrhage and opioid hypoventilation |
| **Respiratory & Skin Cue** | Live-action bedside deterioration clip (`hypoxia_distress_deterioration.mp4`) + interactive 3D Patient Cue Inspector | Candidate observes real-world dark-skin diaphoretic brow sweat, heavy drooping/fluttering opioid-sedated lids, pale perioral mucosa & shallow open-mouth gasping (zero artificial blue tint) |
| **Abdominal Video Cue** | Unlabeled live bedside abdominal video (`jp_drain_hemorrhage.mp4`): midline gauze strikethrough + RLQ Jackson-Pratt (JP) bulb drain + LUQ Gastrostomy (G-tube) | Candidate observes and identifies the condition independently without diagnostic labels (`135 mL/hr` sanguineous output revealed after measuring) |
| **3D Bedside Safety** | Directly interactive 3D left & right bed side rails (`hospital_bed_carlos.glb`) | Candidate visually identifies lowered transfer rails and clicks them in 3D to raise & lock |
| **Initial Telemetry** | `SpO2 88%` · `RR 10/min` · `HR 122 bpm` · `BP 92/58 mmHg` · `EtCO2 54 mmHg` · `Temp 36.6°C` | Dual pathology: **Opioid Respiratory Depression** + **Postoperative Hemorrhage** |
| **Lab Trend** | Pre-op `Hgb 13.4 g/dL` (`Hct 40%`) → PACU `Hgb 9.6 g/dL` (`Hct 29%`); ABG `pH 7.28`, `PaCO2 55`, `PaO2 62`, `HCO3 24` | Acute `3.8 g/dL` hemoglobin drop + uncompensated respiratory acidosis |
| **Allergy Alert** | **Penicillin — Anaphylaxis** (Cefazolin `1 g IV` due now on MAR) | Hold Cefazolin and clarify with prescriber due to cephalosporin cross-sensitivity risk |

---

## 2. Mandatory Open-World Bedside Actions & Clinical Traps

### Expected Priority Actions (8 Scored Bedside Cues)
1. **Power on Bedside Monitor (`POWER_ON_MONITOR`)** — Establish objective telemetry baseline (`SpO2 88%`, `HR 122`, `BP 92/58`, `RR 10`).
2. **Verify Patient Wristband (`VERIFY_PATIENT_ID`)** — Confirm two identifiers (`John Doe` + `1963-09-14`) prior to administering O2, IV fluids, or medications.
3. **Raise & Lock Both 3D Bed Side Rails (`RAISE_SIDE_RAILS`)** — Visually identify lowered side rails and raise & lock both rails in the 3D room.
4. **Review EHR & Flag Penicillin Allergy (`REVIEW_EHR_TAB` + `FLAG_ALLERGY` + `CEFAZOLIN_HELD_ALLERGY`)** — Review MAR, Allergies, Notes, and Labs; flag Penicillin anaphylaxis and hold Cefazolin `1 g IV`.
5. **Pause Morphine PCA Infusion (`PAUSE_PCA`)** — Stop continuous `2 mg/hr` Morphine infusion driving `RR 10/min`.
6. **Elevate Head of Bed (`SET_BED_FOWLERS`)** — Place in Semi-Fowler's (`30°`, knees slightly flexed) to improve diaphragmatic excursion.
7. **Apply Supplemental Oxygen (`ADMINISTER_O2`)** — Initiate PRN oxygen (`Nasal Cannula 4 L/min`, `Simple Mask 8 L/min`, or `Non-Rebreather 15 L/min`).
8. **Empty/Measure JP Drain, Re-Compress Bulb & Reinforce Dressing + Start NS Bolus (`ASSESS_JP_HEMORRHAGE` + `INITIATE_CRYSTALLOID_BOLUS`)** — Empty and measure `135 mL/hr` sanguineous output, compress the JP bulb flat before recapping to restore closed negative suction, reinforce **over** the primary gauze, verify LUQ G-tube (`VERIFY_GTUBE`), and start PRN `0.9% Normal Saline 500 mL` IV bolus.

### Penalized Clinical Traps & Branching Escalations
- **`ALLERGY_CROSS_SENSITIVITY_ERROR` (`-40` Risk Recognition, Critical Safety Event):** Administering Cefazolin `1 g IV` without flagging Penicillin anaphylaxis.
- **`OPIOID_DEMAND_BOLUS_TRAP` (`-30` Risk Recognition, Critical Safety Event):** Administering an extra `1 mg` Morphine PCA bolus to a bradypneic, hypotensive patient.
- **`SALINE_FLUSH_TRAP` (`-20` Risk Recognition):** Rapid normal-saline push through the Morphine PCA line, bolusing residual narcotic in tubing.
- **`REMOVE_PRIMARY_DRESSING_TRAP` (`-20` Risk Recognition):** Peeling off the surgeon's primary laparotomy dressing `<24 hr` post-op during active bleeding instead of reinforcing over it.
- **`TRENDELENBURG_TRAP` (`-20` Prioritisation):** Placing the post-laparotomy patient at `-15°` head-down, pushing abdominal viscera against the diaphragm.
- **`LEAVE_JP_OPEN_TRAP` (`-15` Risk Recognition):** Leaving the JP bulb uncompressed with the drainage plug open to air (destroys closed suction and creates an ascending infection portal).
- **`CONTINUE_BASAL_TRAP` (`-15` Risk Recognition):** Leaving the `2 mg/hr` Morphine basal infusion running (triggers **Branch B: Opioid Masking Crash** -> `RR 7/min`, `EtCO2 64`, requiring **Naloxone `0.4 mg` IV push**).
- **Branch D (`UNRECOGNIZED_HEMORRHAGE_ESCALATION` at `90s`):** Leaving the surgical bleeding and hypotension unaddressed escalates into decompensated hypovolemic shock (`HR 136 bpm`, `BP 78/46 mmHg`).

---

## 3. In-Station Bedside NCLEX Cue Questions (3 Spoiler-Free Items)

### `sq_monitor_cues` — Bedside Telemetry Monitor (`Physiological Adaptation`)
- **Stem:** Review the live telemetry waveforms, vital signs, and bedside presentation in this patient 4 hours post-exploratory laparotomy. Which clinical interpretation best accounts for the current findings?
- **Approved Key:** **`B`** — *"Concurrent opioid-induced respiratory depression and acute postoperative hypovolemia / internal bleeding."*
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `sq_ehr_cross_check` — Patient Chart (`Pharmacological and Parenteral Therapies`)
- **Stem:** Cross-referencing the MAR, Allergy record, and Pre-op vs. PACU CBC labs, which nursing action plan is safest right now?
- **Approved Key:** **`B`** — *"Hold Cefazolin due to beta-lactam cross-sensitivity risk, prepare PRN Naloxone, and correlate the acute hemoglobin drop with bedside abdominal/drain assessment."*
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `sq_surgical_wound` — Abdominal Assessment (`Reduction of Risk Potential`)
- **Stem:** Abdominal Video Check: Based on your visual observation of the patient's abdomen in the live bedside clip, what devices and clinical findings are present?
- **Approved Key:** **`B`** — *"Midline surgical gauze with bright-red sanguineous strikethrough, left-upper-quadrant gastrostomy (G-tube) wafer with clamped tube, and an expanded right-lower-quadrant Jackson-Pratt (JP) bulb filled with dark-red blood."*
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

---

## 4. Post-Simulation Exit Questions (3 Pure Case 01 Items — Zero Image References)

### `q1_sbar` — Question 1 of 3 • SBAR Surgical Escalation (`Management of Care`)
- **Approved Key:** **`B`** — Complete SBAR identifying both opioid respiratory depression and active postoperative hemorrhage (`>100 mL/hr` bright-red JP output + `3.8 g/dL` Hgb drop), reporting bedside stabilization actions and requesting STAT surgical bedside evaluation.
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `q2_abg` — Question 2 of 3 • ABG & Opioid Reversal (`Pharmacological and Parenteral Therapies`)
- **Approved Key:** **`C`** — *"Uncompensated respiratory acidosis — administer naloxone 0.4 mg IV per PRN order, keep the Morphine PCA paused, and monitor closely for renarcotization."*
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`

### `q3_hemorrhage_jp` — Question 3 of 3 • Postoperative Surgical Complication Recognition (`Reduction of Risk Potential`)
- **Approved Key:** **`B`** — *"Progressive tachycardia, hypotension, cool clammy pallor, acute hemoglobin drop, and >100 mL/hr bright-red sanguineous output rapidly expanding a Jackson-Pratt (JP) drain bulb."*
- **SME Sign-Off:** `[ ] Approved` / `[ ] Revise: ______________________`
