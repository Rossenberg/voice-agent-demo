import { BUSINESSES } from "./businesses";
import { saveCallReport } from "./calls";
import { TOOLS, type ToolContext } from "./tools";
import { json, maskName, maskPhone, safeEqual, spokenDate, toHHMM, ToolError } from "./util";

export interface Env {
  DB: D1Database;
  TOOL_SECRET: string;
  ELEVENLABS_WEBHOOK_SECRET?: string;
}

const TOOL_PATHS: Record<string, string> = {
  "check-availability": "check_availability",
  "create-booking": "create_booking",
  "transfer-to-human": "transfer_to_human",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
        },
      });
    }

    try {
      if (request.method === "GET") {
        if (pathname === "/") return json({ ok: true, service: "voice-agent-demo backend" });
        if (pathname.startsWith("/api/")) return await handleDashboardApi(env, pathname, url.searchParams);
      }

      if (request.method === "POST") {
        // ElevenLabs server tools: POST /tools/<tool>?business=dental, body = tool arguments
        const toolMatch = /^\/tools\/([a-z-]+)$/.exec(pathname);
        if (toolMatch) {
          if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
          const name = TOOL_PATHS[toolMatch[1]];
          if (!name) return json({ error: "unknown tool" }, 404);
          const ctx: ToolContext = { db: env.DB, bizKey: url.searchParams.get("business") ?? "dental", platform: "elevenlabs" };
          return json(await runTool(ctx, name, await readJson(request)));
        }

        // Vapi: one server URL for tool calls and end-of-call reports
        if (pathname === "/vapi") {
          if (!isAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
          return await handleVapi(env, url.searchParams.get("business") ?? "auto", await readJson(request));
        }

        if (pathname === "/webhooks/elevenlabs") return await handleElevenLabsWebhook(request, env);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function isAuthorized(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  return !!env.TOOL_SECRET && safeEqual(header, `Bearer ${env.TOOL_SECRET}`);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Runs a tool and turns validation errors into a result the LLM can read and act on. */
async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown>) {
  try {
    return await TOOLS[name](ctx, args);
  } catch (err) {
    if (err instanceof ToolError) return { success: false, error: err.code, message: err.message };
    throw err;
  }
}

// ---------------------------------------------------------------- Vapi

async function handleVapi(env: Env, bizKey: string, body: Record<string, unknown>): Promise<Response> {
  const msg = (body.message ?? {}) as any;
  const callId: string | undefined = msg.call?.id;

  if (msg.type === "tool-calls") {
    const results = [];
    for (const call of msg.toolCallList ?? []) {
      const name = call.function?.name;
      let args = call.function?.arguments ?? {};
      if (typeof args === "string") args = JSON.parse(args || "{}");
      if (callId) args.conversation_id = callId;
      if (!TOOLS[name]) {
        results.push({ toolCallId: call.id, error: `Unknown tool ${name}` });
        continue;
      }
      const result = await runTool({ db: env.DB, bizKey, platform: "vapi" }, name, args);
      results.push({ toolCallId: call.id, result: JSON.stringify(result) });
    }
    return json({ results }); // Vapi requires HTTP 200 even for errors
  }

  if (msg.type === "end-of-call-report" && callId) {
    const startedAt = msg.startedAt ?? msg.call?.startedAt ?? null;
    const endedAt = msg.endedAt ?? msg.call?.endedAt ?? null;
    const duration = msg.durationSeconds ?? (startedAt && endedAt ? (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 : null);
    const messages: any[] = msg.artifact?.messages ?? [];
    await saveCallReport(env.DB, {
      id: callId,
      platform: "vapi",
      startedAt,
      durationSec: duration === null ? null : Math.round(duration),
      summary: msg.analysis?.summary ?? msg.summary ?? null,
      endedReason: msg.endedReason ?? null,
      userSpoke: messages.some((m) => m.role === "user" && (m.message ?? "").trim()),
    }, bizKey);
  }

  return json({ ok: true });
}

// ---------------------------------------------------------------- ElevenLabs post-call webhook

async function handleElevenLabsWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!env.ELEVENLABS_WEBHOOK_SECRET || !(await verifyElevenLabsSignature(raw, request.headers.get("elevenlabs-signature"), env.ELEVENLABS_WEBHOOK_SECRET))) {
    return json({ error: "invalid signature" }, 401);
  }

  const event = JSON.parse(raw);
  if (event.type === "post_call_transcription") {
    const d = event.data ?? {};
    const start = d.metadata?.start_time_unix_secs;
    const transcript: any[] = d.transcript ?? [];
    await saveCallReport(env.DB, {
      id: d.conversation_id,
      platform: "elevenlabs",
      startedAt: start ? new Date(start * 1000).toISOString() : null,
      durationSec: d.metadata?.call_duration_secs ?? null,
      summary: d.analysis?.transcript_summary ?? null,
      endedReason: d.metadata?.termination_reason ?? null,
      userSpoke: transcript.some((t) => t.role === "user" && (t.message ?? "").trim()),
    });
  }
  return json({ received: true });
}

/**
 * Header format "t=<unix secs>,v0=<hex hmac>", HMAC-SHA256 over "<t>.<raw body>",
 * 30-minute tolerance — same as ElevenLabs' SDK `webhooks.constructEvent`.
 */
async function verifyElevenLabsSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const sig = parts.find((p) => p.startsWith("v0="));
  if (!t || !sig) return false;
  if (Number(t) * 1000 < Date.now() - 30 * 60 * 1000) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${raw}`));
  const expected = "v0=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return safeEqual(sig, expected);
}

// ---------------------------------------------------------------- Dashboard API (public, read-only, phones masked)

async function handleDashboardApi(env: Env, pathname: string, params: URLSearchParams): Promise<Response> {
  const business = params.get("business");
  const where = business ? "WHERE business = ?" : "";
  const bind = business ? [business] : [];
  const serviceName = (biz: string, id: string) => BUSINESSES[biz]?.services[id]?.name ?? id;

  switch (pathname) {
    case "/api/bookings": {
      const { results } = await env.DB.prepare(`SELECT * FROM bookings ${where} ORDER BY id DESC LIMIT 50`).bind(...bind).all<any>();
      return json(
        results.map((b) => ({
          booking_id: `${BUSINESSES[b.business]?.bookingPrefix ?? "BK"}-${1000 + b.id}`,
          business: b.business,
          platform: b.platform,
          service: serviceName(b.business, b.service_id),
          patient_name: maskName(b.patient_name),
          phone: maskPhone(b.phone),
          date: b.date,
          date_spoken: spokenDate(b.date),
          time: toHHMM(b.start_min),
          notes: b.notes,
          status: b.status,
          created_at: b.created_at,
        })),
      );
    }
    case "/api/callbacks": {
      const { results } = await env.DB.prepare(`SELECT * FROM callbacks ${where} ORDER BY id DESC LIMIT 50`).bind(...bind).all<any>();
      return json(
        results.map((c) => ({
          ticket_id: `${BUSINESSES[c.business]?.callbackPrefix ?? "CB"}-${100 + c.id}`,
          business: c.business,
          platform: c.platform,
          reason: c.reason,
          summary: c.summary,
          patient_name: maskName(c.patient_name),
          phone: maskPhone(c.phone),
          status: c.status,
          created_at: c.created_at,
        })),
      );
    }
    case "/api/calls": {
      const { results } = await env.DB.prepare(
        `SELECT id, business, platform, COALESCE(started_at, created_at) AS started_at, duration_sec, outcome, summary, ended_reason
         FROM calls ${where} ORDER BY COALESCE(started_at, created_at) DESC LIMIT 50`,
      )
        .bind(...bind)
        .all();
      return json(results);
    }
    case "/api/stats": {
      // Small aggregate queries over indexed, tiny demo tables.
      const [bookings, callbacks, calls] = await env.DB.batch([
        env.DB.prepare(`SELECT COUNT(*) AS n FROM bookings ${where}`).bind(...bind),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM callbacks ${where}`).bind(...bind),
        env.DB.prepare(`SELECT outcome, platform, COUNT(*) AS n, AVG(duration_sec) AS avg_sec FROM calls ${where} GROUP BY outcome, platform`).bind(...bind),
      ]);
      return json({
        bookings: (bookings.results[0] as any).n,
        callbacks: (callbacks.results[0] as any).n,
        calls: calls.results,
      });
    }
  }
  return json({ error: "not found" }, 404);
}
