// ─────────────────────────────────────────────────────────────
// CONTENT SCRIPT — DOM Extractor + Action Executor
// Injected at document_idle on all pages.
// No ES module syntax — plain JS only.
// Hardened for React/Vue, contenteditable, shadow DOM.
// Returns centerX/centerY coordinates for CDP clicks.
// ─────────────────────────────────────────────────────────────

// ── HELPERS ───────────────────────────────────────────────────

function stripNullBytes(str) {
  if (!str) return str;
  return str.replace(/[\u0000-\u001f]/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── PAGE CONTEXT EXTRACTION ──────────────────────────────────

function extractPageContext() {
  const getText = (el) =>
    stripNullBytes((el?.innerText || el?.textContent || "").trim().slice(0, 200));

  // Headings — page structure signal
  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .slice(0, 15)
    .map((h) => ({ tag: h.tagName, text: getText(h) }))
    .filter((h) => h.text.length > 0);

  // Interactive elements — expanded selector for YouTube custom elements
  // and ARIA roles for modern web apps
  const INTERACTABLE_SELECTOR =
    'button, a[href], input, select, textarea, ' +
    '[role="button"], [role="link"], [role="tab"], [role="option"], ' +
    '[role="menuitem"], [role="listitem"], [role="gridcell"], ' +
    'ytd-thumbnail, ytd-rich-item-renderer, ytd-compact-video-renderer, ' +
    'ytd-video-renderer, yt-formatted-string, ' +
    '[tabindex]:not([tabindex="-1"])';

  const interactable = [...document.querySelectorAll(INTERACTABLE_SELECTOR)]
    .slice(0, 60)
    .map((el, i) => {
      // Bounding rect for CDP coordinate-based clicks
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0
        && rect.top < window.innerHeight && rect.bottom > 0
        && window.getComputedStyle(el).visibility !== "hidden"
        && window.getComputedStyle(el).display !== "none";

      // centerX/centerY are viewport-relative CSS pixel coordinates.
      // CDP Input.dispatchMouseEvent uses CSS pixels (device-independent),
      // NOT physical pixels. No DPR scaling needed by the caller.
      return {
        index: i,
        tag: el.tagName,
        type: stripNullBytes(el.type || null),
        role: stripNullBytes(el.getAttribute("role") || null),
        text: stripNullBytes(
          getText(el) || el.getAttribute("aria-label") || el.placeholder || null
        ),
        name: stripNullBytes(el.name || el.id || null),
        href: stripNullBytes(el.href || null),
        value: stripNullBytes(el.value || null),
        centerX: isVisible ? Math.round(rect.left + rect.width / 2) : null,
        centerY: isVisible ? Math.round(rect.top + rect.height / 2) : null,
        visible: isVisible,
        rect: isVisible ? {
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.width), h: Math.round(rect.height)
        } : null,
      };
    })
    .filter((el) => (el.text || el.name || el.href) && (el.visible || el.href));

  // Forms — structured capture of fillable fields
  const forms = [...document.querySelectorAll("form")].slice(0, 5).map((form) => ({
    id: stripNullBytes(form.id || null),
    action: stripNullBytes(form.action || null),
    fields: [...form.querySelectorAll("input, select, textarea")].map((f) => ({
      name: stripNullBytes(f.name || f.id),
      type: stripNullBytes(f.type),
      placeholder: stripNullBytes(f.placeholder || null),
      required: f.required,
    })),
  }));

  // Main content — truncated to avoid token overflow
  const mainEl =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.body;
  const mainText = stripNullBytes(
    mainEl.innerText.replace(/\s\s+/g, " ").trim().slice(0, 4000)
  );

  return {
    url: window.location.href,
    title: document.title,
    headings,
    interactable,
    forms,
    mainText,
    pageHeight: document.body.scrollHeight,
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

// ── ELEMENT FINDER — 5-priority fallback chain ───────────────

async function findElement(hints) {
  // Priority 1: exact CSS selector
  if (hints.selector) {
    try {
      const el = document.querySelector(hints.selector);
      if (el) return el;
    } catch (e) {
      /* invalid selector — fall through */
    }
  }

  // Priority 2: element_index from interactable list
  if (hints.element_index !== undefined) {
    const INTERACTABLE_SELECTOR =
      'button, a[href], input, select, textarea, ' +
      '[role="button"], [role="link"], [role="tab"], [role="option"], ' +
      '[role="menuitem"], [role="listitem"], [role="gridcell"], ' +
      'ytd-thumbnail, ytd-rich-item-renderer, ytd-compact-video-renderer, ' +
      'ytd-video-renderer, yt-formatted-string, ' +
      '[tabindex]:not([tabindex="-1"])';
    const all = document.querySelectorAll(INTERACTABLE_SELECTOR);
    if (all[hints.element_index]) return all[hints.element_index];
  }

  // Priority 3: text content case-insensitive match
  if (hints.text) {
    const all = document.querySelectorAll("button, a, [role='button']");
    const match = [...all].find((el) =>
      el.innerText.trim().toLowerCase().includes(hints.text.toLowerCase())
    );
    if (match) return match;
  }

  // Priority 4: aria-label
  if (hints.ariaLabel) {
    try {
      const el = document.querySelector(`[aria-label="${hints.ariaLabel}"]`);
      if (el) return el;
    } catch (e) {
      /* invalid selector — fall through */
    }
  }

  // Priority 5: coordinates (elementFromPoint)
  if (hints.x && hints.y) {
    return document.elementFromPoint(hints.x, hints.y);
  }

  return null;
}

// ── ACTION EXECUTOR ──────────────────────────────────────────

async function executeAction(action) {
  const { type } = action;

  try {
    // ── CLICK ──────────────────────────────────────────────
    if (type === "click") {
      const target = await findElement(action);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(300);
        target.focus();
        target.click();
        return { success: true, action: "click", element: target.tagName };
      }
      return { success: false, error: "Element not found" };
    }

    // ── FILL FORM ──────────────────────────────────────────
    if (type === "fill_form") {
      let target = null;
      if (action.selector) {
        try {
          target = document.querySelector(action.selector);
        } catch (e) {
          /* invalid selector */
        }
      }
      if (!target && action.field_name) {
        target = [...document.querySelectorAll("input, textarea, select")].find(
          (el) => el.name === action.field_name || el.id === action.field_name
        );
      }
      if (target) {
        target.focus();
        target.value = action.value;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          success: true,
          action: "fill_form",
          field: action.selector || action.field_name,
          value: action.value,
        };
      }
      return {
        success: false,
        error: `Field not found: ${action.selector || action.field_name}`,
      };
    }

    // ── TYPE TEXT — Hardened keystroke simulation ───────────
    if (type === "type_text") {
      const target = await findElement(action);
      if (!target) return { success: false, error: "Element not found for type_text" };

      target.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(200);
      target.focus();
      await sleep(100);

      const isContentEditable = target.contentEditable === "true"
        || target.closest("[contenteditable='true']");

      if (isContentEditable) {
        if (action.clear_first !== false) {
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
        }
        for (const char of action.text) {
          document.execCommand("insertText", false, char);
          if (action.delay_ms > 0) await sleep(action.delay_ms);
        }
      } else {
        if (action.clear_first !== false) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          )?.set
          || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
          )?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(target, "");
            target.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            target.value = "";
          }
        }

        for (const char of action.text) {
          target.dispatchEvent(new KeyboardEvent("keydown", {
            key: char, code: `Key${char.toUpperCase()}`,
            bubbles: true, cancelable: true, composed: true,
          }));
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          )?.set
          || Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
          )?.set;
          const newValue = (target.value || "") + char;
          if (nativeSetter) {
            nativeSetter.call(target, newValue);
          } else {
            target.value = newValue;
          }
          target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          target.dispatchEvent(new KeyboardEvent("keyup", {
            key: char, bubbles: true, cancelable: true, composed: true,
          }));
          if (action.delay_ms > 0) await sleep(action.delay_ms);
        }
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }

      if (action.press_enter_after) {
        await sleep(100);
        target.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Enter", code: "Enter", keyCode: 13,
          bubbles: true, cancelable: true, composed: true,
        }));
        target.dispatchEvent(new KeyboardEvent("keypress", {
          key: "Enter", code: "Enter", keyCode: 13,
          bubbles: true, cancelable: true, composed: true,
        }));
        target.dispatchEvent(new KeyboardEvent("keyup", {
          key: "Enter", code: "Enter", keyCode: 13,
          bubbles: true, cancelable: true, composed: true,
        }));
      }

      return {
        success: true, action: "type_text",
        typed: action.text.slice(0, 80),
        element: target.tagName,
      };
    }

    // ── PRESS KEY — Dispatch keyboard events ───────────────
    if (type === "press_key") {
      let target = document.activeElement;
      if (action.selector) {
        try { target = document.querySelector(action.selector) || target; }
        catch (e) { /* invalid selector */ }
      }

      const keyMap = {
        "Enter":      { keyCode: 13 },
        "Tab":        { keyCode: 9  },
        "Escape":     { keyCode: 27 },
        "ArrowDown":  { keyCode: 40 },
        "ArrowUp":    { keyCode: 38 },
        "ArrowLeft":  { keyCode: 37 },
        "ArrowRight": { keyCode: 39 },
        "Backspace":  { keyCode: 8  },
        "Delete":     { keyCode: 46 },
        " ":          { keyCode: 32 },
        "Space":      { keyCode: 32, key: " " },
      };

      const keyInfo = keyMap[action.key] || { keyCode: 0 };
      const actualKey = keyInfo.key || action.key;
      const modifiers = action.modifiers || [];

      const eventInit = {
        key: actualKey,
        code: `Key${actualKey.toUpperCase()}`,
        keyCode: keyInfo.keyCode,
        which: keyInfo.keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        ctrlKey:  modifiers.includes("Control"),
        shiftKey: modifiers.includes("Shift"),
        altKey:   modifiers.includes("Alt"),
        metaKey:  modifiers.includes("Meta"),
      };

      if (target) {
        target.dispatchEvent(new KeyboardEvent("keydown",  eventInit));
        target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        target.dispatchEvent(new KeyboardEvent("keyup",    eventInit));
      }

      return { success: true, action: "press_key", key: action.key };
    }

    // ── SCROLL ─────────────────────────────────────────────
    if (type === "scroll") {
      const amount = action.direction === "up" ? -action.pixels : action.pixels;
      window.scrollBy({ top: amount, behavior: "smooth" });
      await sleep(500);
      return { success: true, action: "scroll", scrollY: window.scrollY };
    }

    // ── NAVIGATE ───────────────────────────────────────────
    if (type === "navigate") {
      window.location.href = action.url;
      return { success: true, action: "navigate", url: action.url };
    }

    // ── GET TEXT ────────────────────────────────────────────
    if (type === "get_text") {
      const el = await findElement(action);
      return {
        success: true,
        text: el ? stripNullBytes(el.innerText.trim()) : null,
      };
    }

    // ── SUBMIT FORM ────────────────────────────────────────
    if (type === "submit_form") {
      const form = document.querySelector(action.selector || "form");
      if (form) {
        form.submit();
        return { success: true, action: "submit_form" };
      }
      return { success: false, error: "Form not found" };
    }

    return { success: false, error: `Unknown action type: ${type}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── MESSAGE LISTENER ─────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_PAGE_CONTEXT") {
    sendResponse({ success: true, context: extractPageContext() });
    return true;
  }

  if (message.type === "EXECUTE_ACTION") {
    executeAction(message.action)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "PING") {
    sendResponse({ alive: true });
    return true;
  }
});

console.log("[NIM Assistant] Content script loaded on:", window.location.hostname);
