#!/usr/bin/env node
// Compare LLMs for Armenian: runs the same simulated text conversation against a throwaway copy of the
// dental agent, once per model, with tools mocked (nothing is written to the real database).
//   node scripts/armenian-lab.mjs gemini-3.8-flash gpt-4.1 ...
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(ROOT, "backend/.env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const state = JSON.parse(readFileSync(join(ROOT, "agent/dental/elevenlabs.json"), "utf8"));
const LAB_FILE = join(ROOT, "agent/dental/.armenian-lab.json");
const API = "https://api.elevenlabs.io";

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}

const models = process.argv.slice(2);
const EN = process.env.LAB_LANG === "en";
if (!models.length) { console.error("usage: node scripts/armenian-lab.mjs <llm> [<llm> ...]"); process.exit(1); }

// 1. throwaway lab agent = copy of the real one, Armenian only
const main = await api("GET", `/v1/convai/agents/${state.agent_id}`);
const hy = main.conversation_config.language_presets.hy.overrides.agent;
const cfg = structuredClone(main.conversation_config);
if (!EN) {
  cfg.agent.language = "hy";
  cfg.agent.first_message = hy.first_message;
  cfg.agent.dynamic_variables = { dynamic_variable_placeholders: { conversation_language: "Armenian" } };
}
delete cfg.language_presets;
delete cfg.agent.prompt.tools; // keep tool_ids only
if (EN) { cfg.agent.language = "en"; cfg.agent.first_message = main.conversation_config.agent.first_message; cfg.agent.dynamic_variables = { dynamic_variable_placeholders: { conversation_language: "English" } }; }
let labId = existsSync(LAB_FILE) ? JSON.parse(readFileSync(LAB_FILE, "utf8")).agent_id : null;
if (!labId) {
  labId = (await api("POST", "/v1/convai/agents/create", { name: "Armenian LLM lab (temporary)", conversation_config: cfg })).agent_id;
  writeFileSync(LAB_FILE, JSON.stringify({ agent_id: labId }) + "\n");
}

const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 28 * 3600e3).toISOString().slice(0, 10);
const mocks = {
  check_availability: { default_return_value: JSON.stringify({ today, date: tomorrow, open: true, service: { id: "cleaning", name: "Professional cleaning", duration_min: 60 }, available_times: ["10:00", "10:30", "11:00"], alternatives: [] }) },
  create_booking: { default_return_value: JSON.stringify({ success: true, booking_id: "SD-1042", summary: "Professional cleaning at 11:00" }) },
  transfer_to_human: { default_return_value: JSON.stringify({ success: true, ticket_id: "CB-101" }) },
};
const userPrompt = `Դու հիվանդ ես, ով զանգում է ատամնաբուժական կլինիկա։ Խոսիր միայն հայերեն, կարճ, խոսակցական ոճով։
Սկզբում հարցրու ատամների մաքրման գինը։ Հետո ասա, որ ուզում ես գրանցվել վաղը առավոտյան ժամը ինին։
Եթե ինը ազատ չէ, համաձայնիր տասնմեկին։ Անունդ Դավիթ Սարգսյան է, հեռախոսդ՝ 091 23 45 67։ Վերջում շնորհակալություն հայտնիր և հրաժեշտ տուր։`;

for (const llm of models) {
  await api("PATCH", `/v1/convai/agents/${labId}`, { conversation_config: { agent: { ...cfg.agent, prompt: { ...cfg.agent.prompt, llm } } } });
  const t0 = Date.now();
  let res;
  try {
    res = await api("POST", `/v1/convai/agents/${labId}/simulate-conversation`, {
      simulation_specification: {
        simulated_user_config: EN
          ? { first_message: "Hi there", language: "en", prompt: { prompt: "You are a patient calling a dental clinic. Ask the price of a cleaning, then book tomorrow at 9 am; if not free, accept 11. Name David Sargsyan, phone 091 23 45 67. Interrupt once to ask if they treat kids. Say thanks and bye at the end.", llm: "gemini-2.5-flash" } }
          : { first_message: "Բարև Ձեզ", language: "hy", prompt: { prompt: userPrompt, llm: "gemini-2.5-flash" } },
        tool_mock_config: mocks,
        dynamic_variables: { conversation_language: EN ? "English" : "Armenian", system__conversation_id: "lab-test" },
      },
      new_turns_limit: 14,
    });
  } catch (e) { console.log(`\n=== ${llm}: ERROR ${e.message}`); continue; }
  console.log(`\n=== ${llm}  (${((Date.now() - t0) / 1000).toFixed(0)} s total)`);
  for (const t of res.simulated_conversation) {
    if (t.message) console.log(`${t.role === "agent" ? "ANNA" : "USER"}: ${t.message}`);
    for (const c of t.tool_calls || []) console.log(`   [tool ${c.tool_name}]`);
  }
}
console.log(`\nLab agent: ${labId} (delete when done)`);
