// ─────────────────────────────────────────────────────────────
// POPUP SETTINGS — Load / Save + Password Toggles + Open Panel
// Dual-model pipeline: nimReasoningModel + nimVisionModel
// Three providers: NIM, Ollama Cloud, Local Ollama
// ─────────────────────────────────────────────────────────────

// ── Model status updater (pair hint + key status) ────────────

function updateModelStatus() {
  const r = document.getElementById("reasoning-model-select").value;
  const v = document.getElementById("vision-model-select").value;
  const pairHint  = document.getElementById("pair-hint");
  const keyStatus = document.getElementById("key-status");

  // Pair hint (unified vs dual)
  if (r === v) {
    pairHint.textContent = "✅ Unified mode: single model handles planning and vision";
    pairHint.style.color = "#10B981";
  } else {
    pairHint.textContent = "🔀 Dual mode: two separate API calls per screenshot analysis";
    pairHint.style.color = "#6B7280";
  }

  // Key status — tell user which key they need
  function keyNeeded(modelId) {
    if (modelId.startsWith("ollama-cloud/")) return "☁️ Requires: Ollama Cloud API key";
    if (modelId.startsWith("ollama/"))       return "🖥️ Local only: no API key needed";
    return "⚡ Requires: NVIDIA NIM API key";
  }

  const rNeeded = keyNeeded(r);
  const vNeeded = keyNeeded(v);
  keyStatus.textContent = r === v
    ? rNeeded
    : `Reasoning → ${rNeeded}   |   Vision → ${vNeeded}`;
}

// ── Load saved settings on open ──────────────────────────────

chrome.storage.sync.get(
  [
    "nimApiKey", "ollamaCloudApiKey",
    "nimReasoningModel", "nimVisionModel",
    "nimMaxTokens", "nimMaxIterations",
    "confirmForms", "confirmNav",
  ],
  (data) => {
    if (data.nimApiKey) document.getElementById("api-key").value = data.nimApiKey;
    if (data.ollamaCloudApiKey) document.getElementById("ollama-cloud-key").value = data.ollamaCloudApiKey;
    if (data.nimReasoningModel) document.getElementById("reasoning-model-select").value = data.nimReasoningModel;
    if (data.nimVisionModel) document.getElementById("vision-model-select").value = data.nimVisionModel;
    if (data.nimMaxTokens) document.getElementById("max-tokens").value = data.nimMaxTokens;
    if (data.nimMaxIterations) document.getElementById("max-iterations").value = data.nimMaxIterations;
    document.getElementById("confirm-forms").checked = data.confirmForms !== false;
    document.getElementById("confirm-nav").checked = data.confirmNav === true;
    updateModelStatus();
  }
);

// ── Save settings ────────────────────────────────────────────

document.getElementById("save-btn").addEventListener("click", () => {
  const settings = {
    nimApiKey: document.getElementById("api-key").value.trim(),
    ollamaCloudApiKey: document.getElementById("ollama-cloud-key").value.trim(),
    nimReasoningModel: document.getElementById("reasoning-model-select").value,
    nimVisionModel: document.getElementById("vision-model-select").value,
    nimMaxTokens: parseInt(document.getElementById("max-tokens").value),
    nimMaxIterations: parseInt(document.getElementById("max-iterations").value),
    confirmForms: document.getElementById("confirm-forms").checked,
    confirmNav: document.getElementById("confirm-nav").checked,
  };

  chrome.storage.sync.set(settings, () => {
    const statusEl = document.getElementById("status");
    statusEl.classList.add("visible");
    setTimeout(() => {
      statusEl.classList.remove("visible");
    }, 2200);
  });
});

// ── Password show/hide toggles ───────────────────────────────

function setupToggle(toggleId, inputId) {
  const toggle = document.getElementById(toggleId);
  const input = document.getElementById(inputId);
  toggle.addEventListener("click", () => {
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    toggle.textContent = isPassword ? "🙈" : "👁";
  });
}

setupToggle("toggle-key", "api-key");
setupToggle("toggle-ollama-cloud-key", "ollama-cloud-key");

// ── Model select change handlers ─────────────────────────────

document.getElementById("reasoning-model-select").addEventListener("change", updateModelStatus);
document.getElementById("vision-model-select").addEventListener("change", updateModelStatus);

// ── Open Side Panel button ───────────────────────────────────

document.getElementById("open-panel-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
  window.close();
});
