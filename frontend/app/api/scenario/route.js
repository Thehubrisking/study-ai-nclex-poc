import { NextResponse } from 'next/server';
import scenarioData from '../../../config/scenario_hypoxia.json';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/scenario
 *
 * Authoritative scenario + SME-vetted answer-key ingestion endpoint for StudyAI's main
 * backend (Oluwaseun Adeyo) and Clinical SME review (Joe Vener Cabaltera, RN).
 */
export async function GET() {
  const exam = scenarioData?.exam_config || {};
  const stationQuestions = Object.entries(exam.station_questions || {}).map(([stationId, sq]) => ({
    station_id: stationId,
    station_label: exam.station_labels?.[stationId] || stationId,
    question_id: sq.question_id,
    domain: sq.domain,
    ncsbn_category: sq.ncsbn_category,
    prompt: sq.prompt,
    options: sq.options,
    correct_option_id: sq.correct_option_id,
    rationale: sq.rationale,
  }));

  const exitQuestions = (exam.exit_questions || []).map((q) => ({
    question_id: q.question_id,
    domain: q.domain,
    title: q.title,
    ncsbn_category: q.ncsbn_category,
    prompt: q.prompt,
    options: q.options,
    correct_option_id: q.correct_option_id,
    rationale: q.rationale,
  }));

  return NextResponse.json(
    {
      status: 'ok',
      scenario_id: scenarioData.scenario_id,
      version: scenarioData.version,
      title: scenarioData.title,
      sme_vetting_status: 'READY_FOR_RN_SME_SIGN_OFF',
      answer_key_summary: {
        mandatory_bedside_safety_checks: [
          'POWER_ON_MONITOR',
          'VERIFY_PATIENT_ID',
          'RAISE_SIDE_RAILS',
          'REVIEW_EHR_TAB (MAR, ALLERGIES, NOTES, LABS)',
          'FLAG_ALLERGY (Penicillin Anaphylaxis -> Hold Cefazolin)',
        ],
        priority_clinical_interventions: [
          'PAUSE_PCA (Stop continuous Morphine 2 mg/hr infusion)',
          'SET_BED_FOWLERS (Elevate HOB >= 30° Semi-Fowler’s)',
          'ADMINISTER_O2 (Apply supplemental oxygen)',
          'ASSESS_JP_HEMORRHAGE (Measure 135 mL/hr sanguineous JP drain, re-compress bulb, reinforce primary gauze)',
          'INITIATE_CRYSTALLOID_BOLUS (Start PRN 0.9% Normal Saline 500 mL IV bolus for BP 92/58)',
          'VERIFY_GTUBE (Confirm LUQ gastrostomy wafer seal & bilious return)',
        ],
        clinical_traps_penalized: [
          'ALLERGY_CROSS_SENSITIVITY_ERROR (-40 Risk Recognition, Critical Safety Event)',
          'OPIOID_DEMAND_BOLUS_TRAP (-30 Risk Recognition, Critical Safety Event)',
          'SALINE_FLUSH_TRAP (-20 Risk Recognition)',
          'REMOVE_PRIMARY_DRESSING_TRAP (-20 Risk Recognition)',
          'TRENDELENBURG_TRAP (-20 Prioritisation)',
          'LEAVE_JP_OPEN_TRAP (-15 Risk Recognition)',
          'CONTINUE_BASAL_TRAP (-15 Risk Recognition)',
        ],
        station_questions: stationQuestions,
        exit_questions: exitQuestions,
      },
      scenario: scenarioData,
    },
    { headers: CORS_HEADERS }
  );
}
