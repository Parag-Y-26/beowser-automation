// ─────────────────────────────────────────────────────────────
// SIDE PANEL JAVASCRIPT
// Single-pane architecture with streaming, tool events, and
// thinking indicator support. Multi-provider badge display.
// ─────────────────────────────────────────────────────────────

// ── DOM REFS ─────────────────────────────────────────────────

const header     = document.getElementById("header");
const messagesEl = document.getElementById("messages");
const userInput  = document.getElementById("user-input");
const sendBtn    = document.getElementById("send-btn");
const sendIcon   = document.getElementById("send-icon");
const clearBtn   = document.getElementById("clear-btn");
const settingsBtn = document.getElementById("settings-btn");
const modelBadge = document.getElementById("model-badge");

// ── SVG ICONS ─────────────────────────────────────────────────

const SEND_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <line x1="22" y1="2" x2="11" y2="13"/>
  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
</svg>`;

const STOP_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
  <rect x="5" y="5" width="14" height="14" rx="2"/>
</svg>`;

const LOGO_MINI = `<svg width="11" height="11" viewBox="0 0 24 24" fill="#0BC5EA">
  <path d="M12 2L14.5 9H22L16 13.5L18 21L12 16.5L6 21L8 13.5L2 9H9.5L12 2Z"/>
</svg>`;

// ── TOOL ICONS MAP ────────────────────────────────────────────

const TOOL_ICONS = {
  read_page:          "📄",
  click_element:      "🖱️",
  fill_form:          "✏️",
  navigate:           "🌐",
  scroll:             "↕️",
  get_text:           "📝",
  wait:               "⏳",
  submit_form:        "✉️",
  capture_screenshot: "📷",
  analyze_screenshot: "👁️",
  type_text:          "⌨️",
  press_key:          "🔑",
  cdp_click:          "🖱️",
  cdp_type:           "⌨️",
  cdp_key:            "🔑",
};

// ── MODEL LABELS MAP ──────────────────────────────────────────

const MODEL_LABELS = {
  // NIM models
  "meta/llama-3.3-70b-instruct":               "Llama 3.3 70B",
  "meta/llama-3.1-8b-instruct":                "Llama 3.1 8B",
  "meta/llama-4-maverick-17b-128e-instruct":   "Llama 4 Maverick",
  "meta/llama-4-scout-17b-16e-instruct":       "Llama 4 Scout 17B",
  "nvidia/llama-3.1-nemotron-70b-instruct":    "Nemotron 70B",
  "meta/llama-3.2-90b-vision-instruct":        "Llama 3.2 90B Vision",
  "meta/llama-3.2-11b-vision-instruct":        "Llama 3.2 11B Vision",
  // Local Ollama
  "ollama/llama3":                             "Ollama Llama3",
  "ollama/mistral":                            "Ollama Mistral",
  "ollama/llava":                              "Ollama LLaVA",
  // Ollama Cloud
  "ollama-cloud/kimi-k2-thinking":             "Kimi K2 Thinking ☁",
  "ollama-cloud/kimi-k2.5":                    "Kimi K2.5 Vision ☁",
  "ollama-cloud/qwen3.5:35b":                  "Qwen 3.5 35B ☁",
  "ollama-cloud/devstral-small-2":             "Devstral S2 ☁",
  "ollama-cloud/qwen3-vl:30b":                "Qwen VL 30B ☁",
  "ollama-cloud/nemotron-3-nano":              "Nemotron Nano ☁",
  "ollama-cloud/qwen3-next:80b":              "Qwen3 Next 80B ☁",
  "ollama-cloud/ministral-3:8b":              "Ministral 3 8B ☁",
  "ollama-cloud/gpt-oss:120b":                "GPT-OSS 120B ☁",
};

// ── PROVIDER ICON HELPER ──────────────────────────────────────

function getProviderIcon(modelId) {
  if (modelId.startsWith("ollama-cloud/")) return "☁️";
  if (modelId.startsWith("ollama/"))       return "🖥️";
  return "⚡";
}

// ── STATE ─────────────────────────────────────────────────────

let isAgentRunning = false;
let currentTextEl  = null;
let thinkingEl     = null;
let toolElements   = {};
let lastToolEl     = null;
let lastToolName   = null;

// ── INITIALIZATION ────────────────────────────────────────────

chrome.storage.sync.get(["nimReasoningModel", "nimVisionModel"], (data) => {
  const r = data.nimReasoningModel || "ollama-cloud/kimi-k2-thinking";
  const v = data.nimVisionModel    || "ollama-cloud/kimi-k2.5";
  const rIcon  = getProviderIcon(r);
  const vIcon  = getProviderIcon(v);
  const rLabel = MODEL_LABELS[r] || r.split("/").pop();
  const vLabel = MODEL_LABELS[v] || v.split("/").pop();
  modelBadge.textContent = r === v
    ? `${rIcon} ${rLabel}`
    : `${rIcon} ${rLabel} + ${vIcon} ${vLabel}`;
});

// ── UI HELPERS ────────────────────────────────────────────────

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(role, content, cssClass = "") {
  const div = document.createElement("div");
  div.className = `message ${role} ${cssClass}`.trim();

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML =
    role === "user" ? "You" : `${LOGO_MINI} NIM Assistant`;

  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;

  div.appendChild(label);
  div.appendChild(text);
  messagesEl.appendChild(div);
  scrollToBottom();
  return { container: div, textEl: text };
}

// ── THINKING INDICATOR ────────────────────────────────────────

function showThinking() {
  removeThinking();
  const wrap = document.createElement("div");
  wrap.className = "thinking-bubble";
  wrap.id = "thinking-bubble";

  wrap.innerHTML = `
    <div class="thinking-bubble-inner">
      <div class="thinking-label">${LOGO_MINI} NIM Assistant</div>
      <div class="thinking-dots">
        <span></span><span></span><span></span>
      </div>
    </div>`;

  messagesEl.appendChild(wrap);
  scrollToBottom();
  thinkingEl = wrap;
}

function removeThinking() {
  if (thinkingEl && thinkingEl.parentNode) {
    thinkingEl.parentNode.removeChild(thinkingEl);
  }
  thinkingEl = null;
}

// ── STREAMING ─────────────────────────────────────────────────

function startStreamingMessage() {
  removeThinking();

  const div = document.createElement("div");
  div.className = "message assistant";

  const label = document.createElement("div");
  label.className = "message-label";
  label.innerHTML = `${LOGO_MINI} NIM Assistant`;

  const text = document.createElement("div");
  text.className = "message-text";

  const cursor = document.createElement("span");
  cursor.className = "cursor";

  div.appendChild(label);
  div.appendChild(text);
  text.appendChild(cursor);
  messagesEl.appendChild(div);
  scrollToBottom();

  currentTextEl = text;
  return text;
}

function appendChunk(chunk) {
  if (!currentTextEl) startStreamingMessage();
  const cursor = currentTextEl.querySelector(".cursor");
  const textNode = document.createTextNode(chunk);
  if (cursor) currentTextEl.insertBefore(textNode, cursor);
  else currentTextEl.appendChild(textNode);
  scrollToBottom();
}

function finalizeStream() {
  if (currentTextEl) {
    const cursor = currentTextEl.querySelector(".cursor");
    if (cursor) cursor.remove();
  }
  currentTextEl = null;
}

// ── TOOL EVENTS ───────────────────────────────────────────────

function addToolEvent(toolName) {
  const div = document.createElement("div");
  div.className = "tool-event";
  div.innerHTML = `<span class="spinner"></span> <strong>${toolName}</strong> Running…`;
  messagesEl.appendChild(div);
  scrollToBottom();
  return div;
}

function updateToolEvent(el, status, summary) {
  if (status === "done") {
    el.className = "tool-event done";
    const toolName = el.querySelector("strong")?.textContent || "";
    const icon = TOOL_ICONS[toolName] || "✅";
    el.innerHTML = `${icon} <strong>${toolName}</strong> ${summary}`;
  } else if (status === "error") {
    el.className = "tool-event error";
    const toolName = el.querySelector("strong")?.textContent || "";
    el.innerHTML = `❌ <strong>${toolName}</strong> ${summary}`;
  }
}

function findLastToolEl(toolName) {
  const all = messagesEl.querySelectorAll(".tool-event");
  for (let i = all.length - 1; i >= 0; i--) {
    const strong = all[i].querySelector("strong");
    if (strong && strong.textContent.trim() === toolName) return all[i];
  }
  return null;
}

// ── LOADING STATE ─────────────────────────────────────────────

function setLoading(loading) {
  isAgentRunning = loading;
  userInput.disabled = loading;

  if (loading) {
    sendBtn.classList.add("running");
    sendIcon.innerHTML = STOP_SVG;
    header.classList.add("agent-active");
  } else {
    sendBtn.classList.remove("running");
    sendBtn.disabled = false;
    sendIcon.innerHTML = SEND_SVG;
    header.classList.remove("agent-active");
  }
}

// ── WELCOME MESSAGE ───────────────────────────────────────────

function showWelcome() {
  addMessage(
    "assistant",
    "👋 Hi! I'm your NIM Browser Assistant powered by NVIDIA.\n\n" +
      "I use real mouse & keyboard events (CDP) to control any webpage,\n" +
      "including YouTube, Google, React apps, and more.\n\n" +
      'Try:\n• "Play the latest video from Ashish Chanchlani on YouTube"\n• "Search for mechanical keyboards on Amazon and open the first result"\n• "Fill out the contact form on this page"\n• "Summarize this page"'
  );
}

// ── SEND MESSAGE ──────────────────────────────────────────────

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isAgentRunning) return;

  currentTextEl = null;
  toolElements  = {};
  lastToolEl    = null;
  lastToolName  = null;

  addMessage("user", text);
  userInput.value = "";
  userInput.style.height = "auto";
  setLoading(true);

  try {
    await chrome.runtime.sendMessage({
      type: "RUN_AGENT",
      userMessage: text,
      targetPane: 1,
    });
  } catch (err) {
    addMessage(
      "assistant",
      `Connection error: ${err.message}. Try reloading the extension.`,
      "error"
    );
    setLoading(false);
  }
}

// ── AGENT UPDATE RECEIVER ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "AGENT_UPDATE") return;

  const evt = msg.event;

  if (evt === "thinking") {
    showThinking();
    return;
  }

  if (evt === "stream_chunk") {
    appendChunk(msg.chunk);
    return;
  }

  if (evt === "tool_start") {
    removeThinking();
    lastToolEl   = addToolEvent(msg.tool);
    lastToolName = msg.tool;
    return;
  }

  if (evt === "tool_done") {
    const el = findLastToolEl(msg.tool);
    if (el) updateToolEvent(el, "done", msg.summary || "");
    return;
  }

  if (evt === "tool_error") {
    const el = findLastToolEl(msg.tool);
    if (el) updateToolEvent(el, "error", msg.error || "");
    return;
  }

  if (evt === "done") {
    finalizeStream();
    removeThinking();
    setLoading(false);
    return;
  }

  if (evt === "error") {
    finalizeStream();
    removeThinking();
    addMessage("assistant", msg.message || "An unknown error occurred.", "error");
    setLoading(false);
    return;
  }
});

// ── EVENT LISTENERS ───────────────────────────────────────────

sendBtn.addEventListener("click", () => {
  if (isAgentRunning) {
    finalizeStream();
    removeThinking();
    setLoading(false);
  } else {
    sendMessage();
  }
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

userInput.addEventListener("input", () => {
  userInput.style.height = "auto";
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + "px";
});

clearBtn.addEventListener("click", () => {
  messagesEl.innerHTML = "";
  currentTextEl = null;
  toolElements  = {};
  lastToolEl    = null;
  lastToolName  = null;
  chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" }).catch(() => {});
  showWelcome();
});

settingsBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html") });
});

// ── INIT ──────────────────────────────────────────────────────

showWelcome();
