# AI Voice Receptionist — demo

A voice AI agent that answers calls for a business, answers questions from a knowledge base, books appointments into a real database, and hands off to a human when needed.

One **platform-agnostic backend** serves two voice platforms:

| Demo | Business (fictional) | Voice platform | Channel |
|---|---|---|---|
| 1 | Smile Dental Yerevan | ElevenLabs Agents | Website voice widget |
| 2 | Auto service *(coming next)* | Vapi | Phone call |

## Architecture

```
 Caller ──voice──▶ ElevenLabs Agent ─┐                  ┌──▶ D1 (SQLite)
                                     ├─ tool calls ───▶ │    bookings · callbacks · calls
 Caller ──phone──▶ Vapi Assistant  ──┘  (webhooks)      │
                                                        │ Cloudflare Worker
           post-call reports (duration, summary) ─────▶ │  /tools/*  /vapi  /webhooks/elevenlabs
                                                        │
 Dashboard ◀──────────── read-only JSON API ─────────── └─ /api/bookings · /api/calls · /api/stats
```

- **Speech, turn-taking, interruptions**: handled by the voice platform
- **Business logic**: in the Worker, so switching voice providers doesn't touch it
- **No hallucinated slots**: the agent can only offer times that `check_availability` returned; `create_booking` re-checks atomically, so two callers can't take the same chair

## Repository

```
agent/dental/
  system-prompt.md     # role, tone, booking flow, escalation rules, guardrails
  knowledge-base.md    # services & prices (AMD), hours, policies, FAQ
  tools.json           # tool definitions (JSON Schema) shared by both platforms
backend/
  src/index.ts         # router: ElevenLabs tools, Vapi server URL, webhooks, dashboard API
  src/tools.ts         # check_availability · create_booking · transfer_to_human
  src/availability.ts  # opening hours, holidays, 2 parallel chairs, demo "busy" calendar
  src/calls.ts         # call log + outcome (booked / transferred / question / no_interaction)
  migrations/          # D1 schema
```

## Endpoints

| Method | Path | Used by |
|---|---|---|
| POST | `/tools/check-availability` · `/tools/create-booking` · `/tools/transfer-to-human` | ElevenLabs server tools (`Authorization: Bearer <TOOL_SECRET>`) |
| POST | `/vapi?business=…` | Vapi server URL: `tool-calls` and `end-of-call-report` |
| POST | `/webhooks/elevenlabs` | ElevenLabs post-call webhook (HMAC-SHA256 signature verified) |
| GET | `/api/bookings` · `/api/callbacks` · `/api/calls` · `/api/stats` | Dashboard (public demo, phone numbers and surnames masked) |

## Run it yourself

```bash
cd backend
npm install
cp .env.example .env               # set TOOL_SECRET
npx wrangler d1 create voice-agent-demo   # put the id into wrangler.jsonc
npm run db:migrate:local
npm run dev

# production
npm run db:migrate:remote
npx wrangler secret put TOOL_SECRET
npx wrangler secret put ELEVENLABS_WEBHOOK_SECRET
npm run deploy
```

Runs entirely on Cloudflare's free tier.

---

*All business names, prices and contacts are fictional and used for demonstration only.*
