// ─────────────────────────────────────────────────────────────
// NVIDIA NIM / OLLAMA CLOUD / LOCAL OLLAMA — API CLIENT
// OpenAI-compatible. Supports streaming + tool calling.
// Three-provider routing via model prefix:
//   "nim/..." or bare  → NVIDIA NIM
//   "ollama-cloud/..." → Ollama Cloud (ollama.com)
//   "ollama/..."       → Local Ollama (localhost)
// ─────────────────────────────────────────────────────────────

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

// ── MODEL CATALOG ──────────────────────────────────────────
export const NIM_MODELS = {
  // ── NIM — Pair 1: "Balanced" (Recommended NIM Default) ───
  REASONING_BALANCED: "meta/llama-3.3-70b-instruct",
  VISION_BALANCED:    "meta/llama-3.2-90b-vision-instruct",

  // ── NIM — Pair 2: "Speed" (Low Latency) ─────────────────
  REASONING_FAST:     "meta/llama-3.1-8b-instruct",
  VISION_FAST:        "meta/llama-3.2-11b-vision-instruct",

  // ── NIM — Pair 3: "Unified Scout" ───────────────────────
  UNIFIED_SCOUT:      "meta/llama-4-scout-17b-16e-instruct",

  // ── NIM — Pair 4: "Unified Maverick" ────────────────────
  UNIFIED_MAVERICK:   "meta/llama-4-maverick-17b-128e-instruct",

  // ── NIM — Pair 5: "Deep Reasoning" ──────────────────────
  REASONING_DEEP:     "nvidia/llama-3.1-nemotron-70b-instruct",
  VISION_DEEP:        "meta/llama-3.2-90b-vision-instruct",

  // ── NIM — Local Ollama ───────────────────────────────────
  LOCAL_LLAMA3:       "ollama/llama3",
  LOCAL_MISTRAL:      "ollama/mistral",

  // ── Ollama Cloud — Tier 1 Agentic ────────────────────────
  OLLAMA_CLOUD_KIMI_THINKING: "ollama-cloud/kimi-k2-thinking",
  OLLAMA_CLOUD_KIMI_VISION:   "ollama-cloud/kimi-k2.5",

  // ── Ollama Cloud — Tier 2 Vision+Tools ───────────────────
  OLLAMA_CLOUD_QWEN35_35B:    "ollama-cloud/qwen3.5:35b",
  OLLAMA_CLOUD_DEVSTRAL_S2:   "ollama-cloud/devstral-small-2",
  OLLAMA_CLOUD_QWEN_VL_30B:   "ollama-cloud/qwen3-vl:30b",

  // ── Ollama Cloud — Tier 3 Reasoning ──────────────────────
  OLLAMA_CLOUD_NEMOTRON_NANO: "ollama-cloud/nemotron-3-nano",
  OLLAMA_CLOUD_QWEN3_NEXT:    "ollama-cloud/qwen3-next:80b",

  // ── Ollama Cloud — Tier 4 Fast ───────────────────────────
  OLLAMA_CLOUD_MINISTRAL_8B:  "ollama-cloud/ministral-3:8b",
  OLLAMA_CLOUD_GPT_OSS_120B:  "ollama-cloud/gpt-oss:120b",
};

// ── THREE-BRANCH ROUTING LOGIC ─────────────────────────────

function resolveEndpoint(model, apiKey) {
  let actualModel, baseUrl, authHeader;

  if (model.startsWith("ollama-cloud/")) {
    // Ollama Cloud: https://ollama.com/v1 with real API key
    actualModel = model.replace("ollama-cloud/", "");
    baseUrl     = "https://ollama.com/v1/chat/completions";
    authHeader  = `Bearer ${apiKey}`;
  } else if (model.startsWith("ollama/")) {
    // Local Ollama: http://localhost:11434/v1 — no real auth
    actualModel = model.replace("ollama/", "");
    baseUrl     = "http://localhost:11434/v1/chat/completions";
    authHeader  = "Bearer ollama";
  } else {
    // NVIDIA NIM: https://integrate.api.nvidia.com/v1
    actualModel = model;
    baseUrl     = `${NIM_BASE_URL}/chat/completions`;
    authHeader  = `Bearer ${apiKey}`;
  }

  // Key check — skip for local Ollama only
  if (!model.startsWith("ollama/") && !apiKey) {
    throw new Error(
      model.startsWith("ollama-cloud/")
        ? "Ollama Cloud API key not set. Get one at ollama.com/settings/keys"
        : "NVIDIA NIM API key not set. Get one at build.nvidia.com"
    );
  }

  return { actualModel, baseUrl, authHeader };
}

// ─────────────────────────────────────────────────────────────
// callNIM — Reasoning LLM (streaming + tool calling)
// Works with NIM, Ollama Cloud, and local Ollama identically.
// ─────────────────────────────────────────────────────────────

/**
 * Call an LLM via OpenAI-compatible API with streaming support
 *
 * @param {object} params
 * @param {string} params.apiKey         - API key for NIM or Ollama Cloud
 * @param {string} params.model          - Model ID from NIM_MODELS
 * @param {Array}  params.messages       - OpenAI-format message array
 * @param {Array}  params.tools          - Optional tool definitions
 * @param {string} params.systemPrompt   - Optional system prompt (prepended)
 * @param {number} params.maxTokens      - Max output tokens (default: 1024)
 * @param {number} params.temperature    - Sampling temperature (default: 0.2)
 * @param {function} params.onChunk      - Called with each streamed text chunk
 * @returns {Promise<{text: string, tool_calls: Array, finish_reason: string, usage: object}>}
 */
export async function callNIM({
  apiKey,
  model = NIM_MODELS.OLLAMA_CLOUD_KIMI_THINKING,
  messages,
  tools = null,
  systemPrompt = null,
  maxTokens = 1024,
  temperature = 0.2,
  onChunk = null,
}) {
  const { actualModel, baseUrl, authHeader } = resolveEndpoint(model, apiKey);

  // ── Build request body ───────────────────────────────────
  const body = {
    model: actualModel,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    max_tokens: maxTokens,
    temperature,
    stream: !!onChunk,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: onChunk ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  // ── STREAMING MODE ──────────────────────────────────────
  if (onChunk) {
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText      = "";
    let tool_calls    = [];
    let finish_reason = null;
    let usage         = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const json   = JSON.parse(data);
          const choice = json.choices?.[0];
          if (!choice) continue;

          finish_reason = choice.finish_reason || finish_reason;
          if (json.usage) usage = json.usage;

          // Stream text delta
          const delta = choice.delta?.content;
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }

          // Accumulate tool call deltas
          if (choice.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              if (!tool_calls[tc.index]) {
                tool_calls[tc.index] = {
                  id: tc.id || `call_${tc.index}`,
                  type: "function",
                  function: { name: "", arguments: "" },
                };
              }
              if (tc.function?.name)
                tool_calls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments)
                tool_calls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        } catch (e) {
          /* skip malformed SSE chunks */
        }
      }
    }

    // Parse accumulated tool call arguments from JSON strings
    tool_calls = tool_calls.filter(Boolean).map((tc) => {
      try {
        tc.function.arguments = JSON.parse(tc.function.arguments);
      } catch (e) {
        tc.function.arguments = {};
      }
      return tc;
    });

    return { text: fullText, tool_calls, finish_reason, usage };
  }

  // ── NON-STREAMING MODE ──────────────────────────────────
  const json   = await response.json();
  const choice = json.choices?.[0];
  const tool_calls = (choice?.message?.tool_calls || []).map((tc) => {
    try {
      tc.function.arguments = JSON.parse(tc.function.arguments);
    } catch (e) {
      tc.function.arguments = {};
    }
    return tc;
  });

  return {
    text: choice?.message?.content || "",
    tool_calls,
    finish_reason: choice?.finish_reason,
    usage: json.usage,
  };
}

// ─────────────────────────────────────────────────────────────
// callNIMVision — Vision Language Model (non-streaming)
// For screenshot analysis via separate VLM call.
// Same three-branch routing: NIM, Ollama Cloud, local Ollama.
// ─────────────────────────────────────────────────────────────

/**
 * Call a vision model with a base64 image + text question
 *
 * @param {object} params
 * @param {string} params.apiKey       - API key for NIM or Ollama Cloud
 * @param {string} params.model        - VLM model ID
 * @param {string} params.question     - Question about the image
 * @param {string} params.base64Image  - Base64-encoded PNG (no data: prefix)
 * @param {string} params.systemPrompt - Optional system prompt
 * @param {number} params.maxTokens    - Max output tokens (default: 1024)
 * @returns {Promise<{text: string, finish_reason: string, usage: object}>}
 */
export async function callNIMVision({
  apiKey,
  model = NIM_MODELS.OLLAMA_CLOUD_KIMI_VISION,
  question,
  base64Image,
  systemPrompt = null,
  maxTokens = 1024,
}) {
  const { actualModel, baseUrl, authHeader } = resolveEndpoint(model, apiKey);

  // Build multimodal message with image
  const userMessage = {
    role: "user",
    content: [
      { type: "text", text: question },
      {
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64Image}`,
        },
      },
    ],
  };

  const messages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, userMessage]
    : [userMessage];

  const body = {
    model: actualModel,
    messages,
    max_tokens: maxTokens,
    temperature: 0.1,
    stream: false,
  };

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Vision API error ${response.status}: ${errText}`);
  }

  const json   = await response.json();
  const choice = json.choices?.[0];

  return {
    text: choice?.message?.content || "",
    finish_reason: choice?.finish_reason,
    usage: json.usage,
  };
}
