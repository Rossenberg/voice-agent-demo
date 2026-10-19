import { Conversation } from "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm";

const MAX_CALL_SEC = 180; // matches the agent's max_duration_seconds

const $ = (id) => document.getElementById(id);
const statusEl = $("status"), orb = $("orb"), label = $("label"), transcript = $("transcript");
const startBtn = $("startBtn"), endBtn = $("endBtn"), tryEl = $("try"), fab = $("fab");

const TOOL_LABELS = {
  check_availability: ["Checking the schedule…", "Schedule checked"],
  create_booking: ["Creating your booking…", "Booking saved ✓"],
  transfer_to_human: ["Contacting the administrator…", "Callback request sent ✓"],
};

let conversation = null;
let connecting = false;
let timerId = null;
let rafId = null;

function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

function addMessage(text, cls) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  transcript.append(div);
  transcript.scrollTop = transcript.scrollHeight;
  return div;
}

function setInCall(inCall) {
  startBtn.hidden = inCall;
  endBtn.hidden = !inCall;
  tryEl.hidden = inCall;
}

function startTimer() {
  const endsAt = Date.now() + MAX_CALL_SEC * 1000;
  const tick = () => {
    const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
    statusEl.innerHTML = `Live · <span class="timer">${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</span>`;
  };
  tick();
  timerId = setInterval(tick, 1000);
}

function animateOrb() {
  if (!conversation) return;
  const level = Math.min(1, Math.max(conversation.getOutputVolume?.() ?? 0, (conversation.getInputVolume?.() ?? 0) * 0.6) * 2.2);
  orb.style.setProperty("--level", level.toFixed(3));
  rafId = requestAnimationFrame(animateOrb);
}

function resetUi(message) {
  clearInterval(timerId);
  cancelAnimationFrame(rafId);
  orb.style.setProperty("--level", 0);
  orb.dataset.mode = "idle";
  setStatus("Ready", "idle");
  label.textContent = message;
  setInCall(false);
}

async function start() {
  if (conversation || connecting) return;
  const agentId = window.VOICE_DEMO?.elevenlabsAgentId;
  if (!agentId) {
    label.textContent = "The assistant isn’t connected yet. Please check back soon.";
    return;
  }

  connecting = true;
  setStatus("Connecting…", "busy");
  label.textContent = "Allow microphone access to start";
  setInCall(true);

  try {
    // Ask for the mic first so we can show a clear message if it's blocked.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    connecting = false;
    resetUi("Microphone access was blocked. Allow it in your browser and try again.");
    return;
  }

  transcript.replaceChildren();
  const pendingTools = {};

  try {
    conversation = await Conversation.startSession({
      agentId,
      connectionType: "webrtc",
      onConnect: () => {
        startTimer();
        label.textContent = "Connected — say hello";
        animateOrb();
      },
      onDisconnect: () => {
        conversation = null;
        resetUi("Call ended. Thanks for trying the demo!");
      },
      onError: (message) => {
        console.error(message);
        label.textContent = "Something went wrong. Please try again.";
      },
      onModeChange: ({ mode }) => {
        orb.dataset.mode = mode === "speaking" ? "speaking" : "listening";
        label.textContent = mode === "speaking" ? "Anna is speaking…" : "Listening…";
      },
      onMessage: ({ message, role, source }) => {
        const who = role ?? (source === "ai" ? "agent" : "user");
        // Strip expressive voice tags like "[happy]" that the TTS model uses.
        const text = message?.replace(/\[[a-z ]{2,20}\]\s*/gi, "").trim();
        if (text) addMessage(text, who === "user" ? "user" : "agent");
      },
      onAgentToolRequest: (req) => {
        const name = req?.tool_name;
        if (TOOL_LABELS[name]) pendingTools[req.tool_call_id ?? name] = addMessage(TOOL_LABELS[name][0], "tool");
      },
      onAgentToolResponse: (res) => {
        const name = res?.tool_name;
        if (!TOOL_LABELS[name]) return;
        const key = res.tool_call_id ?? name;
        const el = pendingTools[key] ?? addMessage("", "tool");
        el.textContent = res.is_error ? "Tool error — Anna will handle it" : TOOL_LABELS[name][1];
        if (!res.is_error) el.classList.add("ok");
        delete pendingTools[key];
      },
    });
  } catch (err) {
    console.error(err);
    conversation = null;
    resetUi("Couldn’t connect to the assistant. Please try again in a moment.");
  } finally {
    connecting = false;
  }
}

async function stop() {
  await conversation?.endSession();
}

document.querySelectorAll("[data-start]").forEach((el) =>
  el.addEventListener("click", (e) => {
    e.preventDefault();
    $("assistant").scrollIntoView({ behavior: "smooth", block: "center" });
    start();
  }),
);
endBtn.addEventListener("click", stop);

// Floating button appears once the assistant card is off-screen.
new IntersectionObserver(([entry]) => fab.classList.toggle("show", !entry.isIntersecting && !conversation), { threshold: 0.1 }).observe($("assistant"));
