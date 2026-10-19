import { DEFAULT_BUSINESS_BY_PLATFORM } from "./businesses";

// Higher wins: a call that both transferred and booked counts as booked.
const OUTCOME_RANK: Record<string, number> = { no_interaction: 0, question: 1, transferred: 2, booked: 3 };

const RANK_SQL = `CASE %s WHEN 'booked' THEN 3 WHEN 'transferred' THEN 2 WHEN 'question' THEN 1 ELSE 0 END`;

/** Marks the call's outcome while it's still in progress (called from tools). */
export async function recordCallEvent(db: D1Database, id: string, business: string, platform: string, outcome: string) {
  await db
    .prepare(
      `INSERT INTO calls (id, business, platform, outcome) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (id) DO UPDATE SET
         outcome = CASE WHEN ${RANK_SQL.replace("%s", "?4")} > ${RANK_SQL.replace("%s", "calls.outcome")} THEN ?4 ELSE calls.outcome END,
         business = ?2`,
    )
    .bind(id, business, platform, outcome)
    .run();
}

export interface CallReport {
  id: string;
  platform: string;
  startedAt: string | null;
  durationSec: number | null;
  summary: string | null;
  endedReason: string | null;
  userSpoke: boolean;
}

/** Saves the end-of-call report sent by the platform. */
export async function saveCallReport(db: D1Database, r: CallReport, fallbackBusiness?: string) {
  const existing = await db.prepare("SELECT business, outcome FROM calls WHERE id = ?").bind(r.id).first<{ business: string; outcome: string | null }>();

  const business = existing?.business ?? fallbackBusiness ?? DEFAULT_BUSINESS_BY_PLATFORM[r.platform] ?? "dental";
  const baseOutcome = r.userSpoke ? "question" : "no_interaction";
  const outcome =
    existing?.outcome && OUTCOME_RANK[existing.outcome] > OUTCOME_RANK[baseOutcome] ? existing.outcome : baseOutcome;

  await db
    .prepare(
      `INSERT INTO calls (id, business, platform, started_at, duration_sec, outcome, summary, ended_reason)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (id) DO UPDATE SET
         started_at = ?4, duration_sec = ?5, outcome = ?6, summary = ?7, ended_reason = ?8`,
    )
    .bind(r.id, business, r.platform, r.startedAt, r.durationSec, outcome, r.summary, r.endedReason)
    .run();
}
