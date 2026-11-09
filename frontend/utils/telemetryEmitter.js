/**
 * Study AI - NCLEX-RN Diagnostic Telemetry Emitter (v3.0)
 * Sends a complete NGN exam attempt (timeline, traps, safety checks, exit-question responses)
 * to the evaluation engine, which scores it into Study AI's 4 Diagnostic Categories:
 * 1. Knowledge | 2. Prioritisation | 3. Risk Recognition | 4. Clinical Judgment
 *
 * Defaults to the built-in Next.js Serverless route (`/api/evaluate`) so Vercel deployments
 * work out-of-the-box with zero configuration, while `NEXT_PUBLIC_AI_BACKEND_URL` can point
 * to the standalone Python FastAPI server (`http://localhost:8000/api/evaluate`).
 */

export async function sendTelemetry(
  payload,
  backendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || '/api/evaluate'
) {
  try {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Server returned status ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
      );
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    console.error('Telemetry transmission error:', error);
    return { ok: false, error: error.message };
  }
}
