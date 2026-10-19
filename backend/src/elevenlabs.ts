import { saveCallReport, type CallReport } from "./calls";

/** Converts an ElevenLabs conversation object (webhook `data` or GET /conversations/{id}) into a call report. */
export function reportFromElevenLabs(d: any): CallReport {
  const start = d.metadata?.start_time_unix_secs;
  const transcript: any[] = d.transcript ?? [];
  return {
    id: d.conversation_id,
    platform: "elevenlabs",
    startedAt: start ? new Date(start * 1000).toISOString() : null,
    durationSec: d.metadata?.call_duration_secs ?? null,
    summary: d.analysis?.transcript_summary ?? null,
    endedReason: d.metadata?.termination_reason ?? null,
    userSpoke: transcript.some((t) => t.role === "user" && (t.message ?? "").trim()),
  };
}

/**
 * Backup for the post-call webhook: every few minutes, pull recently finished
 * conversations from the ElevenLabs API and fill in any call that has no report yet.
 */
export async function syncElevenLabsCalls(db: D1Database, apiKey: string, agentId: string) {
  const headers = { "xi-api-key": apiKey };
  const list = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=10`, { headers });
  if (!list.ok) throw new Error(`ElevenLabs list ${list.status}`);
  const { conversations = [] } = (await list.json()) as { conversations?: any[] };

  const done = conversations.filter((c) => c.status === "done");
  if (!done.length) return;
  const ids = done.map((c) => c.conversation_id);
  const { results } = await db
    .prepare(`SELECT id FROM calls WHERE duration_sec IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<{ id: string }>();
  const reported = new Set(results.map((r) => r.id));

  for (const id of ids.filter((i) => !reported.has(i))) {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, { headers });
    if (res.ok) await saveCallReport(db, reportFromElevenLabs(await res.json()));
  }
}
