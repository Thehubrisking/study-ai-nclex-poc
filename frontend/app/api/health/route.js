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
 * GET /api/health
 * Service & scenario health probe for StudyAI platform load balancers and CI checks.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'StudyAI NCLEX-RN 3D Simulation & NGN Evaluation Engine',
      version: scenarioData?.version || '3.2',
      scenario_id: scenarioData?.scenario_id || 'nclex_poc_laparotomy_v3',
    },
    { headers: CORS_HEADERS }
  );
}
