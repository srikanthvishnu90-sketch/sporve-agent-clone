// ============================================================================
// coach-assistant — RETIRED 2026-08-14 (tombstone)
// ============================================================================
// Superseded by coach-command, the interpret-only agentic coach turn (see
// docs/COACH-AI-CHATBOX.md and prompts/2026-08-14-coach-ai-audit in the web
// repo). This function had ZERO production calls in its lifetime (ai_audit_log
// carried no coach_assistant rows), and two parallel assistants is one too
// many. A tombstone rather than silent deletion so any stale caller gets an
// explanation instead of a mystery 404.
// ============================================================================
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "coach-assistant is retired. Use coach-command." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } },
  );
});
