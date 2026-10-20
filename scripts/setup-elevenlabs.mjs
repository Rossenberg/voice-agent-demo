#!/usr/bin/env node
// Creates (or updates) the Smile Dental agent in ElevenLabs from the files in agent/dental/:
//   tool secret → knowledge base → 3 webhook tools → post-call webhook → agent
// Safe to re-run: IDs are kept in agent/dental/elevenlabs.json and existing objects are updated.
//
// Usage: node scripts/setup-elevenlabs.mjs        (needs ELEVENLABS_API_KEY and TOOL_SECRET in backend/.env)

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_DIR = join(ROOT, "agent/dental");
const ENV_FILE = join(ROOT, "backend/.env");
const STATE_FILE = join(AGENT_DIR, "elevenlabs.json");
const CONFIG_JS = join(ROOT, "web/config.js");

const BACKEND_URL = "https://voice-agent-demo.gasparyaninvest.workers.dev";
const SITE_HOSTS = ["voice-agent-demo.gasparyaninvest.workers.dev", "localhost"];
const API = "https://api.elevenlabs.io";

const AGENT = {
  name: "Smile Dental Yerevan — Anna",
  firstMessage: "Hi, thanks for calling Smile Dental Yerevan, this is Anna. How can I help you today?",
  llm: "claude-haiku-4-5",
  voiceId: "EXAVITQu4vr4xnSDxMaL", // "Sarah" — calm, warm American English (premade voice)
  maxDurationSec: 180, // a public demo shouldn't burn minutes
  dailyCallLimit: 40,
  // Extra languages: the caller picks one on the website; each gets its own greeting and native voice.
  languages: {
    hy: {
      name: "Armenian",
      firstMessage: "Բարև Ձեզ, «Սմայլ Դենթալ Երևան» կլինիկա, ես Աննան եմ։ Ինչո՞վ կարող եմ օգնել։",
      voiceId: "O9ZoULGkPFs8mHdqJzyB", // "Nare" — warm, native Armenian (shared voice library)
    },
  },
  concurrencyLimit: 2,
};

// ---------------------------------------------------------------- helpers

const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!env.ELEVENLABS_API_KEY) fail("ELEVENLABS_API_KEY is missing in backend/.env");
if (!env.TOOL_SECRET) fail("TOOL_SECRET is missing in backend/.env");

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}\n${text.slice(0, 1500)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

function setEnvVar(key, value) {
  let text = readFileSync(ENV_FILE, "utf8");
  const line = `${key}=${value}`;
  text = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : text.trimEnd() + "\n" + line + "\n";
  writeFileSync(ENV_FILE, text);
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---------------------------------------------------------------- 1. tool secret

async function ensureSecret() {
  if (state.tool_secret_id) return;
  const res = await api("POST", "/v1/convai/secrets", {
    type: "new",
    name: "voice_demo_tool_auth",
    value: `Bearer ${env.TOOL_SECRET}`,
  });
  state.tool_secret_id = res.secret_id;
  saveState();
  console.log("✓ secret stored");
}

// ---------------------------------------------------------------- 2. knowledge base

async function ensureKnowledgeBase() {
  const text = readFileSync(join(AGENT_DIR, "knowledge-base.md"), "utf8");
  const hash = sha(text);
  if (state.kb?.hash === hash) return;
  const res = await api("POST", "/v1/convai/knowledge-base/text", { name: "Smile Dental Yerevan — knowledge base", text });
  state.kb_previous_id = state.kb?.id;
  state.kb = { id: res.id, name: res.name, hash };
  saveState();
  console.log("✓ knowledge base uploaded");
}

// ---------------------------------------------------------------- 3. tools

function toElevenLabsTool(tool) {
  const properties = {};
  for (const [key, p] of Object.entries(tool.parameters.properties)) {
    if (key === "conversation_id") {
      properties[key] = { type: "string", dynamic_variable: "system__conversation_id" };
      continue;
    }
    properties[key] = {
      type: p.type,
      description: p.description ?? `One of: ${(p.enum ?? []).join(", ")}`,
      ...(p.enum ? { enum: p.enum } : {}),
    };
  }
  const path = tool.endpoint.replace("POST {BACKEND_URL}", "");
  return {
    type: "webhook",
    name: tool.name,
    description: tool.description,
    response_timeout_secs: 20,
    api_schema: {
      url: `${BACKEND_URL}${path}?business=dental`,
      method: "POST",
      request_headers: { Authorization: { secret_id: state.tool_secret_id } },
      request_body_schema: {
        type: "object",
        description: `Arguments for ${tool.name}`,
        properties,
        required: tool.parameters.required,
      },
    },
  };
}

async function ensureTools() {
  const { tools } = JSON.parse(readFileSync(join(AGENT_DIR, "tools.json"), "utf8"));
  state.tools ??= {};
  for (const tool of tools) {
    const tool_config = toElevenLabsTool(tool);
    const id = state.tools[tool.name];
    if (id) {
      await api("PATCH", `/v1/convai/tools/${id}`, { tool_config });
    } else {
      const res = await api("POST", "/v1/convai/tools", { tool_config });
      state.tools[tool.name] = res.id;
      saveState();
    }
    console.log(`✓ tool ${tool.name}`);
  }
}

// ---------------------------------------------------------------- 4. post-call webhook

async function ensureWebhook() {
  if (state.webhook_id) return;
  let res;
  try {
    res = await api("POST", "/v1/workspace/webhooks", {
      settings: { auth_type: "hmac", name: "voice-agent-demo post-call", webhook_url: `${BACKEND_URL}/webhooks/elevenlabs` },
    });
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    console.log("! API key lacks the webhooks_write permission — skipping post-call webhook (call log will miss duration/summary)");
    return;
  }
  state.webhook_id = res.webhook_id;
  saveState();
  if (!res.webhook_secret) fail("ElevenLabs did not return a webhook secret");
  setEnvVar("ELEVENLABS_WEBHOOK_SECRET", res.webhook_secret);
  execFileSync("npx", ["wrangler", "secret", "put", "ELEVENLABS_WEBHOOK_SECRET"], {
    cwd: join(ROOT, "backend"),
    input: res.webhook_secret,
    stdio: ["pipe", "ignore", "inherit"],
  });
  console.log("✓ post-call webhook created, secret saved to .env and Cloudflare");
}

// ---------------------------------------------------------------- 5. agent

async function pickVoice() {
  try {
    await api("GET", `/v1/voices/${AGENT.voiceId}`);
    return AGENT.voiceId;
  } catch {
    console.log("! preferred voice not available, using the platform default");
    return undefined;
  }
}

async function ensureAgent() {
  const prompt = readFileSync(join(AGENT_DIR, "system-prompt.md"), "utf8");
  const voiceId = await pickVoice();
  const body = {
    name: AGENT.name,
    tags: ["voice-agent-demo", "dental"],
    conversation_config: {
      agent: {
        first_message: AGENT.firstMessage,
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: { conversation_language: "English" } },
        prompt: {
          prompt,
          llm: AGENT.llm,
          temperature: 0.3,
          tool_ids: Object.values(state.tools),
          knowledge_base: [{ type: "text", id: state.kb.id, name: state.kb.name, usage_mode: "prompt" }],
          built_in_tools: {
            end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
          },
        },
      },
      ...(voiceId ? { tts: { voice_id: voiceId } } : {}),
      language_presets: Object.fromEntries(
        Object.entries(AGENT.languages).map(([code, l]) => [code, { overrides: { agent: { first_message: l.firstMessage, language: code }, tts: { voice_id: l.voiceId } } }]),
      ),
      conversation: { max_duration_seconds: AGENT.maxDurationSec },
    },
    platform_settings: {
      auth: { enable_auth: false, allowlist: SITE_HOSTS.map((hostname) => ({ hostname })) },
      // the website may choose the conversation language (nothing else can be overridden)
      overrides: { conversation_config_override: { agent: { language: true } } },
      call_limits: { agent_concurrency_limit: AGENT.concurrencyLimit, daily_limit: AGENT.dailyCallLimit },
      ...(state.webhook_id
        ? { workspace_overrides: { webhooks: { post_call_webhook_id: state.webhook_id, events: ["transcript"] } } }
        : {}),
    },
  };

  if (state.agent_id) {
    await api("PATCH", `/v1/convai/agents/${state.agent_id}`, body);
    console.log("✓ agent updated");
  } else {
    const res = await api("POST", "/v1/convai/agents/create", body);
    state.agent_id = res.agent_id;
    saveState();
    console.log("✓ agent created");
  }

  if (state.kb_previous_id) {
    await api("DELETE", `/v1/convai/knowledge-base/${state.kb_previous_id}`).catch(() => {});
    delete state.kb_previous_id;
    saveState();
  }
}

// ---------------------------------------------------------------- run

try {
  await ensureSecret();
  await ensureKnowledgeBase();
  await ensureTools();
  await ensureWebhook();
  await ensureAgent();
  writeFileSync(CONFIG_JS, `// Generated by scripts/setup-elevenlabs.mjs — the agent id is public by design.\nwindow.VOICE_DEMO = { elevenlabsAgentId: "${state.agent_id}" };\n`);
  console.log(`\nDone. Agent id: ${state.agent_id}`);
  console.log(`Open in ElevenLabs: https://elevenlabs.io/app/agents/agents/${state.agent_id}`);
} catch (err) {
  if (err.status === 401) fail("ElevenLabs rejected the API key (401). Check ELEVENLABS_API_KEY and its permissions.");
  fail(err.message);
}
