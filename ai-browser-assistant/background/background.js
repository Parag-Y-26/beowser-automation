// BACKGROUND SERVICE WORKER — Orchestrator with Live Tab Tracker + CDP
import { callNIM, callNIMVision, NIM_MODELS } from "../utils/nim_client.js";
import { memory } from "../utils/memory_store.js";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ SYSTEM 1 — LIVE TAB TRACKER ═══════════════════════════════
let _trackedTabId = null;
function isRealWebpage(url) { return url && (url.startsWith("http://") || url.startsWith("https://")); }

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    if (isRealWebpage(tab.url)) { _trackedTabId = tabId; }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === _trackedTabId && changeInfo.status === "complete" && !isRealWebpage(tab.url)) _trackedTabId = null;
  if (changeInfo.status === "complete" && isRealWebpage(tab.url) && !_trackedTabId) _trackedTabId = tabId;
});

chrome.tabs.onRemoved.addListener((tabId) => { if (tabId === _trackedTabId) _trackedTabId = null; });

async function getTargetTab() {
  if (_trackedTabId !== null) {
    try { const tab = await chrome.tabs.get(_trackedTabId); if (isRealWebpage(tab.url)) return tab; } catch (e) { _trackedTabId = null; }
  }
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  const ar = active.find(t => isRealWebpage(t.url));
  if (ar) { _trackedTabId = ar.id; return ar; }
  const all = await chrome.tabs.query({ currentWindow: true });
  const any = all.find(t => isRealWebpage(t.url));
  if (any) { _trackedTabId = any.id; return any; }
  throw new Error("No real webpage tab found. Please open a website first.");
}

function waitForTabReady(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") { clearTimeout(timeout); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || tab.status === "complete") { clearTimeout(timeout); resolve(); return; }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

async function safeTabMessage(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content/content_script.js"] });
      await sleep(300);
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e2) { throw new Error(`Cannot reach tab ${tabId}: ${e2.message}. Try calling wait(2000) first.`); }
  }
}

// ═══ SYSTEM 2 — CDP REAL MOUSE & KEYBOARD ═══════════════════════
const _debuggerAttached = new Set();
chrome.debugger.onDetach.addListener(({ tabId }) => { _debuggerAttached.delete(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => { _debuggerAttached.delete(tabId); });

async function ensureCDPAttached(tabId) {
  if (_debuggerAttached.has(tabId)) return true;
  try { await chrome.debugger.attach({ tabId }, "1.3"); _debuggerAttached.add(tabId); return true; }
  catch (e) { if (e.message?.includes("already attached")) { _debuggerAttached.add(tabId); return true; } return false; }
}

// CDP Input events use CSS pixels (device-independent), NOT physical pixels. No DPR scaling needed.
async function cdpClick(tabId, x, y) {
  if (!await ensureCDPAttached(tabId)) throw new Error("CDP not available for this tab");
  const s = (m, p) => chrome.debugger.sendCommand({ tabId }, m, p);
  await s("Input.dispatchMouseEvent", { type:"mouseMoved", x, y, button:"none", modifiers:0, pointerType:"mouse" });
  await sleep(30);
  await s("Input.dispatchMouseEvent", { type:"mousePressed", x, y, button:"left", buttons:1, clickCount:1, modifiers:0, pointerType:"mouse" });
  await sleep(60);
  await s("Input.dispatchMouseEvent", { type:"mouseReleased", x, y, button:"left", buttons:0, clickCount:1, modifiers:0, pointerType:"mouse" });
}

async function cdpType(tabId, text, delayMs = 30) {
  if (!await ensureCDPAttached(tabId)) throw new Error("CDP not available for this tab");
  for (const c of text) {
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type:"keyDown", key:c, text:c, unmodifiedText:c, modifiers:0, nativeVirtualKeyCode:c.charCodeAt(0), windowsVirtualKeyCode:c.charCodeAt(0) });
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: c });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type:"keyUp", key:c, modifiers:0 });
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function cdpKeyPress(tabId, key, modifiers = 0) {
  if (!await ensureCDPAttached(tabId)) throw new Error("CDP not available for this tab");
  const km = { Enter:13, Tab:9, Escape:27, Backspace:8, Delete:46, ArrowDown:40, ArrowUp:38, ArrowLeft:37, ArrowRight:39, Home:36, End:35, PageDown:34, PageUp:33, " ":32 };
  const kc = km[key] || key.charCodeAt(0);
  const b = { key, modifiers, nativeVirtualKeyCode:kc, windowsVirtualKeyCode:kc };
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type:"keyDown", ...b });
  await sleep(30);
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", { type:"keyUp", ...b });
}

// ═══ SCREENSHOT CACHE ═══════════════════════════════════════════
let _lastScreenshotB64 = null, _lastScreenshotTabId = null;

// ═══ AGENT CANCELLATION ═════════════════════════════════════════
let _agentAbortController = null;

// ═══ BROWSER TOOLS SCHEMA ═══════════════════════════════════════
const BROWSER_TOOLS = [
  { type:"function", function:{ name:"read_page", description:"Read the current page. Always call this first. Returns element indices, text, hrefs, AND centerX/centerY coordinates for CDP clicks.", parameters:{ type:"object", properties:{} } } },
  { type:"function", function:{ name:"click_element", description:"Click an element using DOM .click(). For YouTube/React/shadow DOM, use cdp_click instead.", parameters:{ type:"object", properties:{ element_index:{type:"integer",description:"Index from read_page"}, selector:{type:"string"}, text:{type:"string"}, ariaLabel:{type:"string"}, description:{type:"string"} } } } },
  { type:"function", function:{ name:"fill_form", description:"Fill a form field by name/id or selector.", parameters:{ type:"object", properties:{ field_name:{type:"string"}, selector:{type:"string"}, value:{type:"string"} }, required:["value"] } } },
  { type:"function", function:{ name:"type_text", description:"Simulate typing via DOM events. For YouTube/complex inputs, use cdp_type instead.", parameters:{ type:"object", properties:{ text:{type:"string"}, selector:{type:"string"}, element_index:{type:"integer"}, clear_first:{type:"boolean"}, press_enter_after:{type:"boolean"}, delay_ms:{type:"integer"} }, required:["text"] } } },
  { type:"function", function:{ name:"press_key", description:"Press a key via DOM events. For YouTube, use cdp_key instead.", parameters:{ type:"object", properties:{ key:{type:"string"}, selector:{type:"string"}, modifiers:{type:"array",items:{type:"string"}} }, required:["key"] } } },
  { type:"function", function:{ name:"navigate", description:"Navigate to a new URL.", parameters:{ type:"object", properties:{ url:{type:"string",description:"Full URL including https://"} }, required:["url"] } } },
  { type:"function", function:{ name:"scroll", description:"Scroll page up or down.", parameters:{ type:"object", properties:{ direction:{type:"string",enum:["up","down"]}, pixels:{type:"integer"} }, required:["direction"] } } },
  { type:"function", function:{ name:"get_text", description:"Extract text from an element.", parameters:{ type:"object", properties:{ selector:{type:"string"}, text:{type:"string"} } } } },
  { type:"function", function:{ name:"wait", description:"Wait milliseconds (max 5000).", parameters:{ type:"object", properties:{ ms:{type:"integer"} }, required:["ms"] } } },
  { type:"function", function:{ name:"submit_form", description:"Submit a form by selector.", parameters:{ type:"object", properties:{ selector:{type:"string"} } } } },
  { type:"function", function:{ name:"capture_screenshot", description:"Capture visible page as base64 PNG.", parameters:{ type:"object", properties:{} } } },
  { type:"function", function:{ name:"analyze_screenshot", description:"Send screenshot to vision model with a question.", parameters:{ type:"object", properties:{ question:{type:"string"} }, required:["question"] } } },
  { type:"function", function:{ name:"cdp_click", description:"Click at EXACT coordinates using real hardware mouse (CDP). PREFERRED for YouTube, React, shadow DOM, canvas, or when click_element fails. Get x/y from centerX/centerY in read_page.", parameters:{ type:"object", properties:{ x:{type:"number",description:"centerX from read_page"}, y:{type:"number",description:"centerY from read_page"}, description:{type:"string"} }, required:["x","y"] } } },
  { type:"function", function:{ name:"cdp_type", description:"Type text using real keyboard (CDP). Use for YouTube search, Google search, React inputs, or when other typing fails.", parameters:{ type:"object", properties:{ text:{type:"string"}, selector:{type:"string",description:"CSS selector to focus first"}, delay_ms:{type:"integer"} }, required:["text"] } } },
  { type:"function", function:{ name:"cdp_key", description:"Press a special key using real keyboard (CDP). Works everywhere.", parameters:{ type:"object", properties:{ key:{type:"string",enum:["Enter","Tab","Escape","ArrowDown","ArrowUp","ArrowLeft","ArrowRight","Backspace","Delete"," ","Home","End","PageDown","PageUp"]}, modifiers:{type:"array",items:{type:"string",enum:["Alt","Ctrl","Meta","Shift"]}} }, required:["key"] } } },
  { type:"function", function:{ name:"task_complete", description:"Call this when you have fully completed the user's task. Provide a final summary.", parameters:{ type:"object", properties:{ summary:{type:"string",description:"Final summary of what was accomplished"} }, required:["summary"] } } },
];

// ═══ SYSTEM PROMPT ═══════════════════════════════════════════════
const SYSTEM_PROMPT = `You are an intelligent browser assistant. You control web pages using real mouse & keyboard events (CDP) for maximum compatibility.

RULES:
1. Always call read_page FIRST before any action.
2. After navigation, call wait(1000-2000) then read_page.
3. Be concise — 1-2 sentences before each action.
4. Use element_index from read_page when possible.
5. Execute multi-step tasks one step at a time, and KEEP GOING until fully done.
6. Call task_complete with a summary when the entire task is finished.
7. Explain clearly if blocked (captcha, login, etc.)
8. Never submit forms without user confirmation.
9. Use capture_screenshot + analyze_screenshot when DOM is insufficient.
10. Prefer cdp_type over fill_form/type_text for search boxes and React inputs.
11. ALWAYS use cdp_click instead of click_element for: YouTube, React apps, shadow DOM, or after click_element fails. Get x/y from centerX/centerY in read_page.
12. ALWAYS use cdp_type instead of fill_form/type_text for: YouTube search, Google search, or when typing failed before.
13. For YouTube: read_page → find video centerX/centerY → cdp_click(x, y). Do NOT use click_element for YouTube thumbnails.

MULTI-STEP PERSISTENCE:
- You have up to 50 tool-call rounds. Use them wisely.
- Continue working until the task is FULLY complete, then call task_complete.
- If an action fails, try an alternative approach (different selector, CDP instead of DOM, scroll to reveal elements, etc.)
- After each major step (navigation, click, form fill), briefly state what you did and what's next.
- Do NOT stop early. Do NOT say "task may be incomplete". Keep going.

SAFETY: No destructive actions without confirmation. No payment info. Stop and ask if unsure.`;

// ═══ HELPERS ═════════════════════════════════════════════════════
async function askUserPermission(nid, message) {
  return new Promise((resolve) => {
    chrome.notifications.create(nid, { type:"basic", iconUrl:"../icons/icon48.png", title:"Action Confirmation", message, buttons:[{title:"Allow"},{title:"Deny"}], requireInteraction:true });
    const onBtn = (id, idx) => { if (id !== nid) return; chrome.notifications.onButtonClicked.removeListener(onBtn); chrome.notifications.onClosed.removeListener(onClose); resolve(idx === 0); };
    const onClose = (id) => { if (id !== nid) return; chrome.notifications.onButtonClicked.removeListener(onBtn); chrome.notifications.onClosed.removeListener(onClose); resolve(false); };
    chrome.notifications.onButtonClicked.addListener(onBtn);
    chrome.notifications.onClosed.addListener(onClose);
  });
}

function makeBroadcaster(pane) {
  return (update) => { const { type:t, ...p } = update; chrome.runtime.sendMessage({ type:"AGENT_UPDATE", targetPane:pane, event:t, ...p }).catch(()=>{}); };
}

// ═══ CONTEXT WINDOW MANAGEMENT ══════════════════════════════════
// Prune old messages to stay within token limits.
// Keeps: system context (first user msg), last N messages, and
// compresses old tool results into a compact checkpoint summary.
function pruneMessages(messages, keepRecent = 20) {
  if (messages.length <= keepRecent + 2) return messages;

  // Find the first user message (always keep)
  const firstUserIdx = messages.findIndex(m => m.role === "user");
  const firstUser = firstUserIdx >= 0 ? messages[firstUserIdx] : null;

  // Messages to compress (everything between first user and the tail)
  const tail = messages.slice(-keepRecent);
  const toCompress = messages.slice(firstUserIdx + 1, messages.length - keepRecent);

  if (toCompress.length === 0) return messages;

  // Build a compact summary of compressed messages
  const actions = [];
  for (const m of toCompress) {
    if (m.role === "assistant" && m.content) {
      actions.push(`Assistant: ${m.content.slice(0, 100)}`);
    }
    if (m.role === "tool") {
      try {
        const parsed = JSON.parse(m.content);
        if (parsed.success !== undefined) {
          const toolSummary = parsed.action || parsed.navigated_to || parsed.title || "done";
          actions.push(`Tool result: ${parsed.success ? "✓" : "✗"} ${toolSummary}`);
        }
      } catch { actions.push("Tool result: (data)"); }
    }
  }

  const checkpoint = {
    role: "user",
    content: `[CONTEXT CHECKPOINT — ${toCompress.length} messages compressed]\nPrevious actions taken:\n${actions.slice(-15).join("\n")}\n\nContinue from where you left off. The recent messages below show your latest state.`
  };

  const pruned = [];
  if (firstUser) pruned.push(firstUser);
  pruned.push(checkpoint);
  pruned.push(...tail);
  return pruned;
}

// ═══ STALL DETECTION ════════════════════════════════════════════
// Detects if the model is stuck in a loop (e.g., calling read_page
// repeatedly without taking any action).
function detectStall(recentTools, windowSize = 4) {
  if (recentTools.length < windowSize) return null;
  const last = recentTools.slice(-windowSize);

  // Check if all recent calls are the same tool (e.g., all read_page)
  const allSame = last.every(t => t === last[0]);
  if (allSame && last[0] === "read_page") {
    return `You have called read_page ${windowSize} times in a row without taking any action. The page content hasn't changed. Please either: (1) take an action like click, type, or navigate, (2) try scrolling to reveal more content, (3) use capture_screenshot + analyze_screenshot to visually inspect the page, or (4) explain what is blocking you.`;
  }

  // Check for read_page → read_page → read_page pattern (interspersed with wait)
  const readPageCount = last.filter(t => t === "read_page" || t === "wait").length;
  if (readPageCount >= windowSize - 1) {
    return `You seem to be stuck in a loop of reading the page and waiting. Try a different approach: use CDP tools, scroll, or analyze a screenshot.`;
  }

  return null;
}

// ═══ AGENT LOOP ═════════════════════════════════════════════════
async function runAgentLoop(userMessage, tabId, broadcast, overrideModel) {
  // Create abort controller for this run
  _agentAbortController = new AbortController();
  const abortSignal = _agentAbortController.signal;

  try {
    _lastScreenshotB64 = null; _lastScreenshotTabId = null;
    const stored = await chrome.storage.sync.get(["nimApiKey","ollamaCloudApiKey","nimReasoningModel","nimVisionModel","nimMaxTokens","nimMaxIterations","confirmForms","confirmNav"]);
    const nimApiKey = stored.nimApiKey, ollamaCloudApiKey = stored.ollamaCloudApiKey || "";
    const nimMaxTokens = stored.nimMaxTokens || 1024, confirmForms = stored.confirmForms, confirmNav = stored.confirmNav;
    const maxIterations = stored.nimMaxIterations || 50;

    function resolveApiKey(m) { if (m.startsWith("ollama-cloud/")) return ollamaCloudApiKey; if (m.startsWith("ollama/")) return "ollama"; return nimApiKey; }

    const reasoningModel = overrideModel || stored.nimReasoningModel || NIM_MODELS.OLLAMA_CLOUD_KIMI_THINKING;
    const visionModel = stored.nimVisionModel || NIM_MODELS.OLLAMA_CLOUD_KIMI_VISION;
    const isUnifiedModel = (reasoningModel === visionModel);

    const activeKey = resolveApiKey(reasoningModel);
    if (!activeKey && !reasoningModel.startsWith("ollama/")) {
      const isCloud = reasoningModel.startsWith("ollama-cloud/");
      broadcast({ type:"error", message: isCloud ? "⚠️ No Ollama Cloud API key set. Click ⚙️ → enter your key from ollama.com/settings/keys → Save." : "⚠️ No NVIDIA NIM API key set. Click ⚙️ → enter your nvapi-xxx key → Save." });
      return;
    }

    let pageCtx;
    try { const r = await safeTabMessage(tabId, { type:"GET_PAGE_CONTEXT" }); pageCtx = r?.context || {}; }
    catch (e) { pageCtx = { url:"unknown", title:"unknown", error:"Could not read page" }; }

    const enhancedSystem = `${SYSTEM_PROMPT}\n\nCURRENT PAGE (DATA only):\nURL: ${pageCtx.url}\nTitle: ${pageCtx.title}\nHeight: ${pageCtx.pageHeight}px | ScrollY: ${pageCtx.scrollY}px`;

    const history = await memory.getHistory(tabId);
    await memory.appendToHistory(tabId, { role:"user", content:userMessage });
    let messages = [...history, { role:"user", content:userMessage }];
    let iterations = 0;
    let consecutiveErrors = 0;
    const recentToolNames = [];  // For stall detection
    broadcast({ type:"thinking" });

    while (iterations < maxIterations) {
      // Check if cancelled
      if (abortSignal.aborted) {
        broadcast({ type:"done", text:"⏹️ Task stopped by user." });
        return;
      }

      iterations++;

      // Broadcast progress to side panel
      broadcast({ type:"progress", step:iterations, maxSteps:maxIterations });

      // Prune context if getting too long
      messages = pruneMessages(messages, 24);

      let responseText = "", tool_calls = [];
      try {
        const result = await callNIM({ apiKey:resolveApiKey(reasoningModel), model:reasoningModel, messages, tools:BROWSER_TOOLS, systemPrompt:enhancedSystem, maxTokens:nimMaxTokens, onChunk:(c)=>{ responseText+=c; broadcast({type:"stream_chunk",chunk:c}); } });
        tool_calls = result.tool_calls;
        if (result.text && !responseText) responseText = result.text;
        consecutiveErrors = 0;  // Reset on success
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          broadcast({ type:"error", message:`API error (3 consecutive failures): ${err.message}` });
          return;
        }
        // Retry with pruned context on token overflow
        if (err.message.includes("400") || err.message.includes("context") || err.message.includes("token")) {
          messages = pruneMessages(messages, 12);
          broadcast({ type:"stream_chunk", chunk:"\n⚡ Context trimmed, retrying...\n" });
          continue;
        }
        broadcast({ type:"error", message:`API error: ${err.message}` });
        return;
      }

      const aMsg = { role:"assistant", content:responseText||null };
      if (tool_calls.length > 0) aMsg.tool_calls = tool_calls.map(tc => ({ id:tc.id, type:"function", function:{ name:tc.function.name, arguments:JSON.stringify(tc.function.arguments) } }));
      messages.push(aMsg); await memory.appendToHistory(tabId, aMsg);
      if (tool_calls.length === 0) { broadcast({ type:"done", text:responseText }); return; }

      for (const tc of tool_calls) {
        // Check cancellation between tool calls
        if (abortSignal.aborted) {
          broadcast({ type:"done", text:"⏹️ Task stopped by user." });
          return;
        }

        const toolName = tc.function.name, toolArgs = tc.function.arguments;

        // ── task_complete tool — agent signals it's done ──
        if (toolName === "task_complete") {
          const summary = toolArgs.summary || "Task completed.";
          broadcast({ type:"stream_chunk", chunk: summary });
          broadcast({ type:"done", text: summary });
          const tm = { role:"tool", tool_call_id:tc.id, content:JSON.stringify({ success:true, message:"Task marked complete." }) };
          messages.push(tm); await memory.appendToHistory(tabId, tm);
          return;
        }

        // Track tool names for stall detection
        recentToolNames.push(toolName);

        broadcast({ type:"tool_start", tool:toolName, args:toolArgs });
        let toolResult;

        // Re-validate tab before each tool call
        try { await chrome.tabs.get(tabId); } catch (e) {
          try { const ft = await getTargetTab(); tabId = ft.id; } catch (re) {
            toolResult = { success:false, error:"Lost browser tab: "+re.message };
            broadcast({ type:"tool_error", tool:toolName, error:toolResult.error });
            messages.push({ role:"tool", tool_call_id:tc.id, content:JSON.stringify(toolResult) });
            await memory.appendToHistory(tabId, { role:"tool", tool_call_id:tc.id, content:JSON.stringify(toolResult) });
            continue;
          }
        }

        try {
          if (toolName === "read_page") {
            const resp = await safeTabMessage(tabId, { type:"GET_PAGE_CONTEXT" });
            toolResult = resp?.context || {};
            broadcast({ type:"tool_done", tool:"read_page", summary:`"${toolResult.title||toolResult.url}"` });
          } else if (toolName === "click_element") {
            toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"click", ...toolArgs } });
            broadcast({ type:"tool_done", tool:"click_element", summary:toolArgs.description||toolArgs.selector||"element" });
            await sleep(500);
          } else if (toolName === "fill_form") {
            toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"fill_form", ...toolArgs } });
            broadcast({ type:"tool_done", tool:"fill_form", summary:toolArgs.field_name||toolArgs.selector||"field" });
          } else if (toolName === "type_text") {
            toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"type_text", selector:toolArgs.selector, element_index:toolArgs.element_index, text:toolArgs.text, clear_first:toolArgs.clear_first!==false, press_enter_after:toolArgs.press_enter_after||false, delay_ms:toolArgs.delay_ms??30 } });
            broadcast({ type:"tool_done", tool:"type_text", summary:`"${toolArgs.text.slice(0,40)}"` });
          } else if (toolName === "press_key") {
            toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"press_key", key:toolArgs.key, selector:toolArgs.selector, modifiers:toolArgs.modifiers||[] } });
            broadcast({ type:"tool_done", tool:"press_key", summary:toolArgs.key });
          } else if (toolName === "navigate") {
            let allowed = true;
            if (confirmNav) allowed = await askUserPermission(`nav_${Date.now()}`, `Allow navigation to:\n${toolArgs.url}`);
            if (allowed) {
              await chrome.tabs.update(tabId, { url:toolArgs.url });
              broadcast({ type:"tool_done", tool:"navigate", summary:`Navigating to ${toolArgs.url}...` });
              await waitForTabReady(tabId);
              await sleep(800);
              toolResult = { success:true, navigated_to:toolArgs.url, message:"Page loaded. Call read_page to see the new content." };
            } else {
              toolResult = { success:false, error:"Navigation denied by user." };
              broadcast({ type:"tool_error", tool:"navigate", error:"Denied by user" });
            }
          } else if (toolName === "scroll") {
            toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"scroll", direction:toolArgs.direction, pixels:toolArgs.pixels||600 } });
            broadcast({ type:"tool_done", tool:"scroll", summary:`${toolArgs.direction} ${toolArgs.pixels||600}px` });
          } else if (toolName === "get_text") {
            toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"get_text", ...toolArgs } });
            broadcast({ type:"tool_done", tool:"get_text", summary:toolArgs.selector||toolArgs.text||"" });
          } else if (toolName === "wait") {
            const w = Math.min(toolArgs.ms||1000, 5000); await sleep(w);
            toolResult = { success:true, waited_ms:w };
            broadcast({ type:"tool_done", tool:"wait", summary:`${w}ms` });
          } else if (toolName === "submit_form") {
            let allowed = true;
            if (confirmForms) allowed = await askUserPermission(`form_${Date.now()}`, `Allow form submission?`);
            if (allowed) { toolResult = await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"submit_form", selector:toolArgs.selector } }); broadcast({ type:"tool_done", tool:"submit_form", summary:"Submitted" }); }
            else { toolResult = { success:false, error:"Denied by user." }; broadcast({ type:"tool_error", tool:"submit_form", error:"Denied" }); }
          } else if (toolName === "capture_screenshot") {
            const wid = (await chrome.tabs.get(tabId)).windowId;
            const du = await chrome.tabs.captureVisibleTab(wid, { format:"png" });
            _lastScreenshotB64 = du.replace("data:image/png;base64,",""); _lastScreenshotTabId = tabId;
            toolResult = { success:true, message:"Screenshot captured. Call analyze_screenshot with your question." };
            broadcast({ type:"tool_done", tool:"capture_screenshot", summary:"Captured" });
          } else if (toolName === "analyze_screenshot") {
            if (!_lastScreenshotB64 || _lastScreenshotTabId !== tabId) {
              const wid = (await chrome.tabs.get(tabId)).windowId;
              const du = await chrome.tabs.captureVisibleTab(wid, { format:"png" });
              _lastScreenshotB64 = du.replace("data:image/png;base64,",""); _lastScreenshotTabId = tabId;
            }
            let analysisText;
            if (isUnifiedModel) {
              const vm = [...messages, { role:"user", content:[{ type:"text", text:toolArgs.question },{ type:"image_url", image_url:{ url:"data:image/png;base64,"+_lastScreenshotB64 } }] }];
              analysisText = (await callNIM({ apiKey:resolveApiKey(reasoningModel), model:reasoningModel, messages:vm, maxTokens:512, temperature:0.1 })).text;
            } else {
              analysisText = (await callNIMVision({ apiKey:resolveApiKey(visionModel), model:visionModel, question:toolArgs.question, base64Image:_lastScreenshotB64, maxTokens:512 })).text;
            }
            toolResult = { success:true, analysis:analysisText };
            broadcast({ type:"tool_done", tool:"analyze_screenshot", summary:toolArgs.question.slice(0,60) });
          } else if (toolName === "cdp_click") {
            try { await cdpClick(tabId, toolArgs.x, toolArgs.y); await sleep(300); toolResult = { success:true, action:"cdp_click", clicked_at:`(${toolArgs.x},${toolArgs.y})`, description:toolArgs.description||"" }; broadcast({ type:"tool_done", tool:"cdp_click", summary:toolArgs.description||`(${toolArgs.x},${toolArgs.y})` }); }
            catch (ce) { toolResult = { success:false, error:`CDP click failed: ${ce.message}` }; broadcast({ type:"tool_error", tool:"cdp_click", error:ce.message }); }
          } else if (toolName === "cdp_type") {
            try {
              if (toolArgs.selector) { try { await safeTabMessage(tabId, { type:"EXECUTE_ACTION", action:{ type:"click", selector:toolArgs.selector } }); await sleep(200); } catch(e){} }
              await cdpType(tabId, toolArgs.text, toolArgs.delay_ms??30);
              toolResult = { success:true, action:"cdp_type", typed:toolArgs.text.slice(0,80) };
              broadcast({ type:"tool_done", tool:"cdp_type", summary:`"${toolArgs.text.slice(0,40)}"` });
            } catch (ce) { toolResult = { success:false, error:`CDP type failed: ${ce.message}` }; broadcast({ type:"tool_error", tool:"cdp_type", error:ce.message }); }
          } else if (toolName === "cdp_key") {
            try {
              await cdpKeyPress(tabId, toolArgs.key, (toolArgs.modifiers||[]).reduce((a,m) => a|({Alt:1,Ctrl:2,Meta:4,Shift:8}[m]||0), 0));
              toolResult = { success:true, action:"cdp_key", key:toolArgs.key };
              broadcast({ type:"tool_done", tool:"cdp_key", summary:toolArgs.key });
            } catch (ce) { toolResult = { success:false, error:`CDP key failed: ${ce.message}` }; broadcast({ type:"tool_error", tool:"cdp_key", error:ce.message }); }
          } else {
            toolResult = { success:false, error:`Unknown tool: ${toolName}` };
          }
        } catch (err) { toolResult = { success:false, error:err.message }; broadcast({ type:"tool_error", tool:toolName, error:err.message }); }
        const tm = { role:"tool", tool_call_id:tc.id, content:JSON.stringify(toolResult) };
        messages.push(tm); await memory.appendToHistory(tabId, tm);
      }

      // ── Stall detection — inject nudge if stuck ──
      const stallMsg = detectStall(recentToolNames, 4);
      if (stallMsg) {
        const nudge = { role:"user", content: stallMsg };
        messages.push(nudge);
        recentToolNames.length = 0;  // Reset after nudge
      }
    }

    // Reached max iterations — but give a friendlier message
    broadcast({ type:"error", message:`⚠️ Reached ${maxIterations} steps. The task may need to be continued. Type "continue" to keep going from where I left off.` });
  } catch (topErr) { console.error("[Agent] FATAL:", topErr); broadcast({ type:"error", message:"❌ Agent error: "+topErr.message }); }
  finally { _agentAbortController = null; }
}

// ═══ KEYBOARD SHORTCUT ══════════════════════════════════════════
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "open-sidepanel") { const [tab] = await chrome.tabs.query({ active:true, currentWindow:true }); if (tab) await chrome.sidePanel.open({ tabId:tab.id }); }
});

// ═══ MESSAGE HANDLER ════════════════════════════════════════════
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_AGENT") {
    const broadcast = makeBroadcaster(message.targetPane||1);
    (async () => {
      try { const tab = await getTargetTab(); runAgentLoop(message.userMessage, tab.id, broadcast, message.overrideModel||null); }
      catch (err) { broadcast({ type:"error", message:"⚠️ "+err.message }); }
    })();
    sendResponse({ started:true }); return true;
  }
  if (message.type === "STOP_AGENT") {
    if (_agentAbortController) { _agentAbortController.abort(); }
    sendResponse({ stopped:true }); return true;
  }
  if (message.type === "CLEAR_HISTORY") {
    chrome.tabs.query({ active:true, currentWindow:true }, ([tab]) => { if (tab) memory.clearHistory(tab.id); });
    sendResponse({ cleared:true }); return true;
  }
  if (message.type === "OPEN_SIDEPANEL") {
    chrome.tabs.query({ active:true, currentWindow:true }, async ([tab]) => { if (tab) await chrome.sidePanel.open({ tabId:tab.id }); });
    sendResponse({ opened:true }); return true;
  }
});

console.log("[Agent] Background started (NIM + Ollama Cloud + Local + CDP + Robust Loop v2)");
