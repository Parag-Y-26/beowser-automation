# 🤖 AI-Powered Browser Automation Tool — System Architecture & Technical Reference

> A comprehensive technical blueprint for building a production-grade browser automation engine powered by **Ollama** (local & cloud LLMs) and **NVIDIA NIM API**, with structured DOM interaction, multi-agent workflows, and extensible API layers.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Core Components](#3-core-components)
4. [AI Provider Layer](#4-ai-provider-layer)
   - 4.1 [Ollama Integration](#41-ollama-integration)
   - 4.2 [NVIDIA NIM API Integration](#42-nvidia-nim-api-integration)
   - 4.3 [Provider Routing & Fallback](#43-provider-routing--fallback)
5. [Browser Control Layer](#5-browser-control-layer)
   - 5.1 [Playwright / Puppeteer Engine](#51-playwright--puppeteer-engine)
   - 5.2 [CDP (Chrome DevTools Protocol)](#52-cdp-chrome-devtools-protocol)
   - 5.3 [DOM Interaction Engine](#53-dom-interaction-engine)
6. [DOM Parsing & Representation](#6-dom-parsing--representation)
   - 6.1 [Accessibility Tree Extraction](#61-accessibility-tree-extraction)
   - 6.2 [DOM-to-Markdown Serialization](#62-dom-to-markdown-serialization)
   - 6.3 [Semantic Element Tagging (SOM)](#63-semantic-element-tagging-som)
7. [Agent Action System](#7-agent-action-system)
   - 7.1 [Action Schema](#71-action-schema)
   - 7.2 [Action Execution Pipeline](#72-action-execution-pipeline)
   - 7.3 [Multi-Step Planning](#73-multi-step-planning)
8. [API Calling Workflows](#8-api-calling-workflows)
   - 8.1 [LLM Request Flow](#81-llm-request-flow)
   - 8.2 [Tool Use / Function Calling](#82-tool-use--function-calling)
   - 8.3 [Streaming & Buffering](#83-streaming--buffering)
9. [Memory & State Management](#9-memory--state-management)
10. [Vision & Multimodal Pipeline](#10-vision--multimodal-pipeline)
11. [Session Management & Sandboxing](#11-session-management--sandboxing)
12. [Security Architecture](#12-security-architecture)
13. [Observability & Tracing](#13-observability--tracing)
14. [Technology Stack](#14-technology-stack)
15. [Data Flow Diagrams](#15-data-flow-diagrams)
16. [Configuration Reference](#16-configuration-reference)
17. [Deployment Architecture](#17-deployment-architecture)
18. [Extending the System](#18-extending-the-system)

---

## 1. System Overview

This system is a **multi-agent, AI-native browser automation framework** that translates natural language instructions into deterministic browser actions. It operates through a tightly integrated loop:

```
User Instruction → AI Planning → DOM Analysis → Action Execution → Observation → Repeat
```

The framework supports:

- **Local inference** via Ollama (Llama 3.x, Qwen2.5, Mistral, Phi-3, etc.)
- **Cloud accelerated inference** via NVIDIA NIM API (LLaMA-3.1-70B-Instruct, Mistral-Large, Nemotron, etc.)
- **Vision-Language Models (VLMs)** for screenshot-based interaction (LLaVA, Phi-3-Vision, NVLM)
- **Headless and headful browser sessions** using Playwright/Puppeteer over CDP
- **Structured tool-use / function-calling** for deterministic action dispatch

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE LAYER                           │
│         CLI  │  REST API  │  WebSocket  │  Python SDK  │  Web UI        │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                         ORCHESTRATION LAYER                             │
│   Task Planner  │  Action Dispatcher  │  Error Recovery  │  Loop Manager│
└──────┬─────────────────┬────────────────────┬────────────────┬──────────┘
       │                 │                    │                │
┌──────▼──────┐  ┌───────▼────────┐  ┌───────▼──────┐  ┌────▼──────────┐
│  AI LAYER   │  │  BROWSER LAYER │  │ MEMORY LAYER │  │ VISION LAYER  │
│             │  │                │  │              │  │               │
│ Ollama      │  │ Playwright/CDP  │  │ Short-term   │  │ Screenshot    │
│ NVIDIA NIM  │  │ DOM Engine     │  │ Long-term    │  │ VLM Inference │
│ Router      │  │ JS Executor    │  │ Vector Store │  │ SOM Parser    │
└─────────────┘  └────────────────┘  └──────────────┘  └───────────────┘
       │                 │
┌──────▼─────────────────▼──────────────────────────────────────────────┐
│                        INFRASTRUCTURE LAYER                            │
│    Redis (Cache)  │  PostgreSQL  │  Qdrant (Vector)  │  Prometheus    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

| Component | Responsibility | Technology |
|---|---|---|
| **Task Planner** | Decomposes high-level user goals into sub-tasks | LLM + Chain-of-Thought |
| **Action Dispatcher** | Maps planned actions to browser API calls | Python / Node.js |
| **DOM Engine** | Extracts, normalizes, and serializes page DOM | Playwright + Custom Parser |
| **AI Router** | Routes inference requests to Ollama or NIM | Python routing layer |
| **Memory Manager** | Maintains task context, history, and page state | Redis + Qdrant |
| **Vision Pipeline** | Processes screenshots for element detection | VLM + bounding box extractor |
| **Session Manager** | Isolates browser contexts per task | Playwright BrowserContext |
| **Tool Registry** | Defines callable browser actions as LLM tools | JSON Schema |

---

## 4. AI Provider Layer

### 4.1 Ollama Integration

Ollama runs a local OpenAI-compatible REST server, making it straightforward to integrate using standard HTTP or the `ollama` Python/JS SDK.

#### Ollama API Endpoint

```
Base URL: http://localhost:11434
Chat:     POST /api/chat
Generate: POST /api/generate
Models:   GET  /api/tags
```

#### Python Integration Example

```python
import httpx
import json

class OllamaProvider:
    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3.2"):
        self.base_url = base_url
        self.model = model
        self.client = httpx.AsyncClient(timeout=120.0)

    async def chat(self, messages: list[dict], tools: list[dict] | None = None) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.1,   # Low temp for deterministic automation
                "num_ctx": 8192,
                "top_p": 0.9
            }
        }
        if tools:
            payload["tools"] = tools

        response = await self.client.post(
            f"{self.base_url}/api/chat",
            json=payload
        )
        response.raise_for_status()
        return response.json()

    async def stream_chat(self, messages: list[dict]):
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True
        }
        async with self.client.stream("POST", f"{self.base_url}/api/chat", json=payload) as r:
            async for line in r.aiter_lines():
                if line:
                    chunk = json.loads(line)
                    if not chunk.get("done"):
                        yield chunk["message"]["content"]

    async def chat_with_vision(self, messages: list[dict], image_b64: str) -> dict:
        """Attach screenshot to message for VLM inference (LLaVA, Phi-3-Vision)"""
        messages[-1]["images"] = [image_b64]
        return await self.chat(messages)
```

#### Supported Ollama Models for Automation

| Model | Context | Tool Use | Vision | Best For |
|---|---|---|---|---|
| `llama3.2:3b` | 128k | ✅ | ❌ | Fast, lightweight tasks |
| `llama3.2:latest` | 128k | ✅ | ❌ | General automation |
| `qwen2.5:7b` | 32k | ✅ | ❌ | Code generation, structured output |
| `mistral-nemo:latest` | 128k | ✅ | ❌ | Complex reasoning |
| `llava:13b` | 4k | ❌ | ✅ | Screenshot analysis |
| `phi3.5:3.8b` | 128k | ✅ | ✅ | Efficient multimodal |

---

### 4.2 NVIDIA NIM API Integration

NVIDIA NIM provides optimized inference endpoints with TensorRT-LLM backends, delivering significantly lower latency for large models.

#### NIM API Endpoint Structure

```
Base URL:  https://integrate.api.nvidia.com/v1
Chat:      POST /chat/completions
Embeddings: POST /embeddings
Models:    GET  /models

Authentication: Bearer token via x-api-key header
```

#### Python Integration Example

```python
import httpx
from pydantic import BaseModel

class NIMProvider:
    BASE_URL = "https://integrate.api.nvidia.com/v1"

    def __init__(self, api_key: str, model: str = "meta/llama-3.1-70b-instruct"):
        self.api_key = api_key
        self.model = model
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self.client = httpx.AsyncClient(timeout=180.0)

    async def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        temperature: float = 0.1,
        max_tokens: int = 4096
    ) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "top_p": 0.95,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        response = await self.client.post(
            f"{self.BASE_URL}/chat/completions",
            headers=self.headers,
            json=payload
        )
        response.raise_for_status()
        return response.json()

    async def stream_chat(self, messages: list[dict]):
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "max_tokens": 4096
        }
        async with self.client.stream(
            "POST",
            f"{self.BASE_URL}/chat/completions",
            headers=self.headers,
            json=payload
        ) as r:
            async for line in r.aiter_text():
                if line.startswith("data: ") and not line.strip() == "data: [DONE]":
                    chunk = json.loads(line[6:])
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta

    async def vision_chat(self, messages: list[dict], image_url: str) -> dict:
        """Uses NVLM-D or llama-3.2-90b-vision for screenshot-based reasoning"""
        messages[-1]["content"] = [
            {"type": "text", "text": messages[-1]["content"]},
            {"type": "image_url", "image_url": {"url": image_url}}
        ]
        return await self.chat(messages)
```

#### Recommended NIM Models for Automation

| Model | Context | Tool Use | Vision | Notes |
|---|---|---|---|---|
| `meta/llama-3.1-70b-instruct` | 128k | ✅ | ❌ | Best general reasoning |
| `meta/llama-3.2-90b-vision-instruct` | 128k | ✅ | ✅ | Best VLM for automation |
| `mistralai/mistral-large-2-instruct` | 128k | ✅ | ❌ | Strong structured output |
| `nvidia/nemotron-4-340b-instruct` | 4k | ✅ | ❌ | Max reasoning quality |
| `nv-embedqa-e5-v5` | — | — | — | Embeddings for memory |

---

### 4.3 Provider Routing & Fallback

```python
from enum import Enum
import asyncio

class ProviderStrategy(Enum):
    LOCAL_FIRST   = "local_first"    # Try Ollama, fallback to NIM
    CLOUD_FIRST   = "cloud_first"    # Try NIM, fallback to Ollama
    VISION_AUTO   = "vision_auto"    # Route VLM tasks to best available
    COST_OPTIMAL  = "cost_optimal"   # Balance latency vs. cost
    PERFORMANCE   = "performance"    # Always use NIM for max quality

class AIRouter:
    def __init__(self, ollama: OllamaProvider, nim: NIMProvider, strategy: ProviderStrategy):
        self.ollama = ollama
        self.nim = nim
        self.strategy = strategy

    async def route(self, messages: list[dict], requires_vision: bool = False, tools: list[dict] | None = None) -> dict:
        if requires_vision:
            # Always use VLM-capable provider
            if await self._check_ollama_health():
                return await self.ollama.chat_with_vision(messages, tools)
            return await self.nim.vision_chat(messages, tools)

        if self.strategy == ProviderStrategy.LOCAL_FIRST:
            try:
                return await asyncio.wait_for(self.ollama.chat(messages, tools), timeout=30)
            except Exception:
                return await self.nim.chat(messages, tools)

        elif self.strategy == ProviderStrategy.PERFORMANCE:
            return await self.nim.chat(messages, tools)

        elif self.strategy == ProviderStrategy.COST_OPTIMAL:
            # Simple heuristic: use local for short tasks, cloud for complex
            total_tokens_estimate = sum(len(m["content"]) for m in messages) // 4
            if total_tokens_estimate < 2000:
                return await self.ollama.chat(messages, tools)
            return await self.nim.chat(messages, tools)

    async def _check_ollama_health(self) -> bool:
        try:
            resp = await self.ollama.client.get(f"{self.ollama.base_url}/api/tags", timeout=3)
            return resp.status_code == 200
        except Exception:
            return False
```

---

## 5. Browser Control Layer

### 5.1 Playwright / Puppeteer Engine

Playwright is the recommended browser control library due to its robust async API, multi-browser support, and excellent network interception capabilities.

```python
from playwright.async_api import async_playwright, Page, BrowserContext

class BrowserEngine:
    def __init__(self):
        self.playwright = None
        self.browser = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None

    async def launch(
        self,
        headless: bool = True,
        stealth: bool = True,
        proxy: dict | None = None
    ):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(
            headless=headless,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--disable-extensions",
            ]
        )
        context_options = {
            "viewport": {"width": 1280, "height": 900},
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
            "locale": "en-US",
        }
        if proxy:
            context_options["proxy"] = proxy

        self.context = await self.browser.new_context(**context_options)

        if stealth:
            await self._inject_stealth_scripts()

        self.page = await self.context.new_page()

    async def _inject_stealth_scripts(self):
        """Override automation detection fingerprints"""
        await self.context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        """)

    async def navigate(self, url: str, wait_until: str = "domcontentloaded"):
        await self.page.goto(url, wait_until=wait_until, timeout=30000)

    async def screenshot(self, full_page: bool = False) -> bytes:
        return await self.page.screenshot(full_page=full_page, type="png")

    async def execute_js(self, script: str, *args):
        return await self.page.evaluate(script, *args)

    async def close(self):
        await self.context.close()
        await self.browser.close()
        await self.playwright.stop()
```

---

### 5.2 CDP (Chrome DevTools Protocol)

CDP provides low-level browser control beyond what Playwright exposes natively.

```python
class CDPController:
    def __init__(self, page):
        self.page = page

    async def get_cdp_session(self):
        return await self.page.context.new_cdp_session(self.page)

    async def enable_network_interception(self, cdp):
        """Capture and optionally modify network requests"""
        await cdp.send("Network.enable")
        await cdp.send("Fetch.enable", {"patterns": [{"requestStage": "Request"}]})

        cdp.on("Fetch.requestPaused", self._handle_request)

    async def _handle_request(self, event):
        request_id = event["requestId"]
        url = event["request"]["url"]
        # Modify, block, or log requests here

    async def capture_performance_metrics(self, cdp):
        await cdp.send("Performance.enable")
        metrics = await cdp.send("Performance.getMetrics")
        return {m["name"]: m["value"] for m in metrics["metrics"]}

    async def get_dom_snapshot(self, cdp) -> dict:
        """Full DOM snapshot including shadow DOM"""
        return await cdp.send("DOMSnapshot.captureSnapshot", {
            "computedStyles": ["display", "visibility", "pointer-events"],
            "includeDOMRects": True,
            "includePaintOrder": True
        })
```

---

### 5.3 DOM Interaction Engine

```python
class DOMInteractor:
    def __init__(self, page):
        self.page = page

    async def click(self, selector: str | None = None, coordinates: tuple | None = None):
        if selector:
            await self.page.locator(selector).first.click(timeout=5000)
        elif coordinates:
            await self.page.mouse.click(coordinates[0], coordinates[1])

    async def type_text(self, selector: str, text: str, clear_first: bool = True):
        locator = self.page.locator(selector).first
        if clear_first:
            await locator.clear()
        await locator.type(text, delay=50)  # Human-like typing delay

    async def scroll(self, direction: str = "down", amount: int = 500):
        script = f"window.scrollBy(0, {amount if direction == 'down' else -amount})"
        await self.page.evaluate(script)

    async def wait_for_element(self, selector: str, timeout: int = 10000):
        await self.page.wait_for_selector(selector, timeout=timeout, state="visible")

    async def get_element_text(self, selector: str) -> str:
        return await self.page.locator(selector).first.inner_text()

    async def fill_form(self, form_data: dict[str, str]):
        """Bulk form filling with smart field detection"""
        for field_selector, value in form_data.items():
            element = self.page.locator(field_selector).first
            element_type = await element.get_attribute("type")

            if element_type in ("checkbox", "radio"):
                if value.lower() in ("true", "yes", "1"):
                    await element.check()
            elif await element.evaluate("el => el.tagName") == "SELECT":
                await element.select_option(label=value)
            else:
                await self.type_text(field_selector, value)

    async def hover_and_wait(self, selector: str, wait_ms: int = 500):
        await self.page.locator(selector).first.hover()
        await self.page.wait_for_timeout(wait_ms)

    async def drag_and_drop(self, source: str, target: str):
        await self.page.drag_and_drop(source, target)
```

---

## 6. DOM Parsing & Representation

The AI model cannot directly consume raw HTML (too verbose, too noisy). The system uses three complementary techniques to represent the DOM to the LLM efficiently.

### 6.1 Accessibility Tree Extraction

The Accessibility Tree is the cleanest representation of interactive elements.

```python
class AccessibilityExtractor:
    def __init__(self, page):
        self.page = page

    async def get_interactive_elements(self) -> list[dict]:
        """Extract all interactive elements from the accessibility tree"""
        tree = await self.page.accessibility.snapshot(interesting_only=True)
        elements = []
        self._traverse(tree, elements)
        return elements

    def _traverse(self, node: dict, result: list, depth: int = 0):
        if not node:
            return
        role = node.get("role", "")
        name = node.get("name", "")
        value = node.get("value", "")

        interactive_roles = {
            "button", "link", "textbox", "combobox", "checkbox",
            "radio", "listbox", "option", "menuitem", "tab", "searchbox"
        }

        if role in interactive_roles and name:
            result.append({
                "role": role,
                "name": name,
                "value": value,
                "depth": depth,
                "checked": node.get("checked"),
                "disabled": node.get("disabled", False),
                "focused": node.get("focused", False),
            })

        for child in node.get("children", []):
            self._traverse(child, result, depth + 1)

    async def get_labeled_dom(self) -> str:
        """Returns a compact labeled DOM string for LLM consumption"""
        elements = await self.get_interactive_elements()
        lines = []
        for i, el in enumerate(elements):
            status = " [DISABLED]" if el["disabled"] else ""
            value_str = f' value="{el["value"]}"' if el["value"] else ""
            lines.append(f'[{i}] {el["role"]}: "{el["name"]}"{value_str}{status}')
        return "\n".join(lines)
```

---

### 6.2 DOM-to-Markdown Serialization

```python
import re
from bs4 import BeautifulSoup

class DOMSerializer:
    SKIP_TAGS = {"script", "style", "noscript", "svg", "path", "meta", "link"}
    BLOCK_TAGS = {"div", "section", "article", "main", "aside", "header", "footer", "nav"}
    HEADING_MAP = {"h1": "#", "h2": "##", "h3": "###", "h4": "####", "h5": "#####"}

    async def page_to_markdown(self, page) -> str:
        html = await page.content()
        return self._html_to_markdown(html)

    def _html_to_markdown(self, html: str) -> str:
        soup = BeautifulSoup(html, "html.parser")

        # Remove noise
        for tag in soup(self.SKIP_TAGS):
            tag.decompose()

        lines = []
        self._process_node(soup.body or soup, lines)
        text = "\n".join(lines)

        # Clean up excess whitespace
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def _process_node(self, node, lines: list):
        from bs4 import Tag, NavigableString

        if isinstance(node, NavigableString):
            text = node.strip()
            if text:
                lines.append(text)
            return

        tag = node.name
        if not tag or tag in self.SKIP_TAGS:
            return

        if tag in self.HEADING_MAP:
            text = node.get_text(strip=True)
            lines.append(f"\n{self.HEADING_MAP[tag]} {text}\n")
        elif tag == "a":
            href = node.get("href", "#")
            text = node.get_text(strip=True)
            lines.append(f"[{text}]({href})")
        elif tag == "input":
            input_type = node.get("type", "text")
            name = node.get("name") or node.get("id") or node.get("placeholder", "")
            value = node.get("value", "")
            lines.append(f"<INPUT type={input_type} name={name} value={value}>")
        elif tag == "button":
            lines.append(f"<BUTTON>{node.get_text(strip=True)}</BUTTON>")
        elif tag == "select":
            name = node.get("name") or node.get("id", "")
            options = [o.get_text(strip=True) for o in node.find_all("option")]
            lines.append(f"<SELECT name={name} options={options}>")
        elif tag in ("p", "li"):
            lines.append(node.get_text(strip=True))
        else:
            for child in node.children:
                self._process_node(child, lines)
```

---

### 6.3 Semantic Element Tagging (SOM)

Set-of-Marks (SOM) overlays numeric labels on a screenshot so a VLM can reference elements by number rather than by XPath or CSS selector.

```python
import base64
from PIL import Image, ImageDraw, ImageFont
import io

class SOMAnnotator:
    async def annotate_screenshot(self, page) -> tuple[bytes, dict]:
        """
        1. Takes a screenshot
        2. Finds all visible interactive elements and their bounding boxes
        3. Overlays colored numbered labels onto the screenshot
        4. Returns annotated image bytes + a mapping {label_id -> element_info}
        """
        screenshot = await page.screenshot(type="png")
        elements = await self._get_element_boxes(page)

        img = Image.open(io.BytesIO(screenshot)).convert("RGBA")
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        element_map = {}
        for i, el in enumerate(elements):
            box = el["box"]
            x, y, w, h = box["x"], box["y"], box["width"], box["height"]
            label = str(i + 1)
            element_map[label] = el

            # Draw bounding box
            draw.rectangle([x, y, x + w, y + h], outline=(255, 50, 50, 220), width=2)

            # Draw label badge
            badge_x, badge_y = x, max(0, y - 18)
            draw.rectangle([badge_x, badge_y, badge_x + len(label) * 9 + 6, badge_y + 16],
                          fill=(255, 50, 50, 200))
            draw.text((badge_x + 3, badge_y + 1), label, fill="white")

        annotated = Image.alpha_composite(img, overlay).convert("RGB")
        buf = io.BytesIO()
        annotated.save(buf, format="PNG")
        return buf.getvalue(), element_map

    async def _get_element_boxes(self, page) -> list[dict]:
        return await page.evaluate("""
            () => {
                const selectors = 'a, button, input, select, textarea, [role="button"], [onclick]';
                return Array.from(document.querySelectorAll(selectors))
                    .filter(el => {
                        const rect = el.getBoundingClientRect();
                        const style = window.getComputedStyle(el);
                        return rect.width > 0 && rect.height > 0
                            && style.display !== 'none'
                            && style.visibility !== 'hidden';
                    })
                    .map(el => ({
                        tag: el.tagName.toLowerCase(),
                        type: el.type || null,
                        text: el.innerText?.slice(0, 80) || el.value?.slice(0, 80) || '',
                        placeholder: el.placeholder || '',
                        href: el.href || null,
                        box: el.getBoundingClientRect().toJSON()
                    }));
            }
        """)
```

---

## 7. Agent Action System

### 7.1 Action Schema

All browser actions are defined as a strict JSON schema, serving as both LLM tool definitions and as a validation layer.

```json
{
  "tools": [
    {
      "name": "navigate",
      "description": "Navigate the browser to a given URL",
      "parameters": {
        "type": "object",
        "properties": {
          "url": { "type": "string", "description": "Fully qualified URL to navigate to" }
        },
        "required": ["url"]
      }
    },
    {
      "name": "click",
      "description": "Click an element identified by CSS selector or SOM label",
      "parameters": {
        "type": "object",
        "properties": {
          "selector": { "type": "string", "description": "CSS selector for the element" },
          "som_label": { "type": "integer", "description": "SOM numeric label from the annotated screenshot" },
          "description": { "type": "string", "description": "Human-readable description of what is being clicked" }
        }
      }
    },
    {
      "name": "type",
      "description": "Type text into a focused or specified input element",
      "parameters": {
        "type": "object",
        "properties": {
          "selector": { "type": "string" },
          "text": { "type": "string" },
          "press_enter": { "type": "boolean", "default": false }
        },
        "required": ["text"]
      }
    },
    {
      "name": "scroll",
      "description": "Scroll the page in a direction",
      "parameters": {
        "type": "object",
        "properties": {
          "direction": { "type": "string", "enum": ["up", "down", "left", "right"] },
          "amount_px": { "type": "integer", "default": 500 }
        },
        "required": ["direction"]
      }
    },
    {
      "name": "extract_data",
      "description": "Extract structured data from the current page",
      "parameters": {
        "type": "object",
        "properties": {
          "fields": {
            "type": "array",
            "items": { "type": "string" },
            "description": "List of field names to extract"
          },
          "format": { "type": "string", "enum": ["json", "csv", "markdown"] }
        },
        "required": ["fields"]
      }
    },
    {
      "name": "wait",
      "description": "Wait for a condition or duration",
      "parameters": {
        "type": "object",
        "properties": {
          "condition": { "type": "string", "description": "CSS selector to wait for" },
          "duration_ms": { "type": "integer" }
        }
      }
    },
    {
      "name": "finish",
      "description": "Signal that the task is complete",
      "parameters": {
        "type": "object",
        "properties": {
          "result": { "type": "string", "description": "Summary of what was accomplished" },
          "data": { "type": "object", "description": "Any extracted data" }
        },
        "required": ["result"]
      }
    }
  ]
}
```

---

### 7.2 Action Execution Pipeline

```python
import json
from dataclasses import dataclass
from typing import Any

@dataclass
class ActionResult:
    success: bool
    observation: str
    data: Any = None
    error: str | None = None

class ActionExecutor:
    def __init__(self, browser: BrowserEngine, dom: DOMInteractor):
        self.browser = browser
        self.dom = dom

    async def execute(self, action_name: str, params: dict) -> ActionResult:
        handler = getattr(self, f"_action_{action_name}", None)
        if not handler:
            return ActionResult(False, "", error=f"Unknown action: {action_name}")
        try:
            return await handler(**params)
        except Exception as e:
            return ActionResult(False, "", error=str(e))

    async def _action_navigate(self, url: str) -> ActionResult:
        await self.browser.navigate(url)
        title = await self.browser.page.title()
        return ActionResult(True, f"Navigated to {url}. Page title: '{title}'")

    async def _action_click(self, selector: str | None = None, som_label: int | None = None, **_) -> ActionResult:
        if selector:
            await self.dom.click(selector=selector)
            return ActionResult(True, f"Clicked element: {selector}")
        return ActionResult(False, "", error="No selector or SOM label provided")

    async def _action_type(self, text: str, selector: str | None = None, press_enter: bool = False) -> ActionResult:
        if selector:
            await self.dom.type_text(selector, text)
        else:
            await self.browser.page.keyboard.type(text, delay=40)
        if press_enter:
            await self.browser.page.keyboard.press("Enter")
        return ActionResult(True, f"Typed: '{text[:50]}...' " if len(text) > 50 else f"Typed: '{text}'")

    async def _action_scroll(self, direction: str = "down", amount_px: int = 500) -> ActionResult:
        await self.dom.scroll(direction, amount_px)
        return ActionResult(True, f"Scrolled {direction} by {amount_px}px")

    async def _action_extract_data(self, fields: list[str], format: str = "json") -> ActionResult:
        """Delegates back to LLM for intelligent extraction"""
        # This re-invokes the AI with an extraction-specific prompt
        dom_text = await DOMSerializer().page_to_markdown(self.browser.page)
        return ActionResult(True, "Data extracted", data={"dom": dom_text, "fields": fields})

    async def _action_wait(self, condition: str | None = None, duration_ms: int = 1000) -> ActionResult:
        if condition:
            await self.dom.wait_for_element(condition)
            return ActionResult(True, f"Element appeared: {condition}")
        await self.browser.page.wait_for_timeout(duration_ms)
        return ActionResult(True, f"Waited {duration_ms}ms")

    async def _action_finish(self, result: str, data: dict | None = None) -> ActionResult:
        return ActionResult(True, result, data=data)
```

---

### 7.3 Multi-Step Planning

```python
class AutomationAgent:
    MAX_STEPS = 30
    SYSTEM_PROMPT = """
You are a browser automation agent. You will be given a task and the current state of a browser.
Your job is to select and execute browser actions step-by-step until the task is complete.

Rules:
- Always analyze the current DOM or screenshot before acting
- Prefer CSS selectors from the accessibility tree over XPath
- If an action fails, try an alternative approach
- Use 'finish' when the task is fully complete
- Never loop on the same action more than 3 times
"""

    def __init__(self, ai_router: AIRouter, browser: BrowserEngine, action_executor: ActionExecutor):
        self.ai = ai_router
        self.browser = browser
        self.executor = action_executor
        self.history: list[dict] = []

    async def run(self, task: str) -> dict:
        self.history = [{"role": "system", "content": self.SYSTEM_PROMPT}]
        self.history.append({"role": "user", "content": f"TASK: {task}"})

        for step in range(self.MAX_STEPS):
            # Capture current state
            dom_text = await AccessibilityExtractor(self.browser.page).get_labeled_dom()
            url = self.browser.page.url

            state_message = f"""
Step {step + 1}/{self.MAX_STEPS}
Current URL: {url}
Current Page Elements:
{dom_text}

Select the next action to take.
"""
            self.history.append({"role": "user", "content": state_message})

            # Get AI decision
            response = await self.ai.route(
                messages=self.history,
                tools=self._get_tool_definitions()
            )

            # Parse tool call
            choice = response["choices"][0]["message"]
            self.history.append({"role": "assistant", "content": choice.get("content", ""), **choice})

            tool_calls = choice.get("tool_calls", [])
            if not tool_calls:
                # Model returned text, not a tool call — re-prompt
                continue

            tool_call = tool_calls[0]
            action_name = tool_call["function"]["name"]
            params = json.loads(tool_call["function"]["arguments"])

            # Execute action
            result = await self.executor.execute(action_name, params)

            observation = f"Action '{action_name}' → {'SUCCESS' if result.success else 'FAILED'}: {result.observation}"
            if result.error:
                observation += f"\nError: {result.error}"

            self.history.append({
                "role": "tool",
                "tool_call_id": tool_call["id"],
                "content": observation
            })

            if action_name == "finish":
                return {"success": True, "result": result.observation, "data": result.data, "steps": step + 1}

        return {"success": False, "result": "Max steps reached", "steps": self.MAX_STEPS}
```

---

## 8. API Calling Workflows

### 8.1 LLM Request Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        LLM REQUEST LIFECYCLE                         │
│                                                                      │
│  1. Agent prepares messages[]                                        │
│     ├── system prompt (instructions, constraints)                   │
│     ├── user message (task description)                              │
│     ├── assistant messages (prior actions)                           │
│     └── tool messages (action results / observations)               │
│                                                                      │
│  2. AI Router selects provider (Ollama / NIM)                       │
│                                                                      │
│  3. Request dispatched with:                                        │
│     ├── model identifier                                             │
│     ├── temperature (0.0–0.2 for automation)                        │
│     ├── max_tokens (1024–4096)                                       │
│     ├── tools[] (action schema definitions)                         │
│     └── tool_choice: "auto"                                         │
│                                                                      │
│  4. Response parsed:                                                │
│     ├── content → reasoning trace (CoT)                             │
│     └── tool_calls[] → actions to execute                           │
│                                                                      │
│  5. Actions dispatched → Observations collected                     │
│                                                                      │
│  6. Observations appended to messages[] as "tool" role              │
│                                                                      │
│  7. Loop back to step 1                                              │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 8.2 Tool Use / Function Calling

Both Ollama (with supported models) and NIM use the OpenAI-compatible tool use protocol:

```python
# Request with tools
payload = {
    "model": "llama3.2",
    "messages": messages,
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "click",
                "description": "Click a DOM element",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "selector": {"type": "string"}
                    },
                    "required": ["selector"]
                }
            }
        }
    ],
    "tool_choice": "auto"
}

# Parse tool call from response
def parse_tool_calls(response: dict) -> list[dict]:
    message = response["choices"][0]["message"]
    calls = []
    for tc in message.get("tool_calls", []):
        calls.append({
            "id": tc["id"],
            "name": tc["function"]["name"],
            "args": json.loads(tc["function"]["arguments"])
        })
    return calls

# Append tool result
messages.append({
    "role": "tool",
    "tool_call_id": "call_abc123",
    "content": "Action succeeded: Clicked login button"
})
```

---

### 8.3 Streaming & Buffering

```python
import asyncio
from collections import deque

class StreamingResponseHandler:
    def __init__(self, buffer_size: int = 256):
        self.buffer = deque()
        self.lock = asyncio.Lock()
        self.complete = asyncio.Event()

    async def consume_stream(self, provider, messages: list[dict]):
        """Consumes a streaming response and buffers tool-use JSON safely"""
        full_response = ""
        in_json_block = False
        json_buffer = ""

        async for chunk in provider.stream_chat(messages):
            full_response += chunk

            # Detect start of JSON tool call
            if "{" in chunk and not in_json_block:
                in_json_block = True
            if in_json_block:
                json_buffer += chunk
                # Try to parse complete JSON
                try:
                    parsed = json.loads(json_buffer)
                    async with self.lock:
                        self.buffer.append(parsed)
                    json_buffer = ""
                    in_json_block = False
                except json.JSONDecodeError:
                    pass  # Keep buffering

        self.complete.set()
        return full_response
```

---

## 9. Memory & State Management

```python
import redis.asyncio as aioredis
from qdrant_client import AsyncQdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance

class MemoryManager:
    def __init__(self, redis_url: str = "redis://localhost:6379", qdrant_url: str = "http://localhost:6333"):
        self.redis = aioredis.from_url(redis_url)
        self.qdrant = AsyncQdrantClient(url=qdrant_url)
        self.collection = "browser_memories"

    # --- Short-Term: Session Context (Redis) ---

    async def save_step(self, session_id: str, step: int, data: dict):
        key = f"session:{session_id}:step:{step}"
        await self.redis.setex(key, 3600, json.dumps(data))

    async def get_session_history(self, session_id: str) -> list[dict]:
        keys = await self.redis.keys(f"session:{session_id}:step:*")
        steps = []
        for k in sorted(keys):
            raw = await self.redis.get(k)
            if raw:
                steps.append(json.loads(raw))
        return steps

    async def cache_dom_state(self, session_id: str, url: str, dom_hash: str, dom_text: str):
        key = f"dom:{session_id}:{url}"
        await self.redis.setex(key, 300, json.dumps({"hash": dom_hash, "content": dom_text}))

    # --- Long-Term: Semantic Memory (Qdrant + Embeddings) ---

    async def store_successful_pattern(self, task: str, actions: list[dict], embedding: list[float]):
        await self.qdrant.upsert(
            collection_name=self.collection,
            points=[PointStruct(
                id=hash(task) % (2**63),
                vector=embedding,
                payload={"task": task, "actions": actions}
            )]
        )

    async def recall_similar_tasks(self, query_embedding: list[float], top_k: int = 3) -> list[dict]:
        results = await self.qdrant.search(
            collection_name=self.collection,
            query_vector=query_embedding,
            limit=top_k,
            score_threshold=0.75
        )
        return [r.payload for r in results]
```

---

## 10. Vision & Multimodal Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VISION PIPELINE WORKFLOW                        │
│                                                                     │
│  Page State                                                         │
│      │                                                              │
│      ▼                                                              │
│  Screenshot (PNG) ──────────────────────────────────────────────┐  │
│      │                          │                                │  │
│      ▼                          ▼                                │  │
│  SOM Annotator             Accessibility Tree                    │  │
│  (adds numbered             (text representation)               │  │
│   bounding boxes)                │                              │  │
│      │                          │                               │  │
│      ▼                          ▼                               │  │
│  Base64 Encode          DOM-to-Markdown                         │  │
│      │                          │                               │  │
│      └──────────┬───────────────┘                               │  │
│                 ▼                                                │  │
│         VLM Prompt Construction                                  │  │
│         ┌─────────────────────────────────────────┐             │  │
│         │  "Here is the current browser state.    │             │  │
│         │   Screenshot with labeled elements:     │             │  │
│         │   [IMAGE]                               │             │  │
│         │   Accessible elements: [DOM TEXT]       │             │  │
│         │   Task: [USER TASK]                     │             │  │
│         │   What action should be taken next?"    │             │  │
│         └─────────────────────────────────────────┘             │  │
│                 │                                                │  │
│                 ▼                                                │  │
│         Ollama (LLaVA/Phi3V)  OR  NIM (llama-3.2-90b-vision)   │  │
│                 │                                                │  │
│                 ▼                                                │  │
│         Action Decision (SOM label → CSS selector resolution)   │  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 11. Session Management & Sandboxing

```python
import uuid
from contextlib import asynccontextmanager

class SessionOrchestrator:
    def __init__(self):
        self.active_sessions: dict[str, BrowserEngine] = {}

    @asynccontextmanager
    async def create_session(self, config: dict = {}):
        session_id = str(uuid.uuid4())
        engine = BrowserEngine()
        await engine.launch(
            headless=config.get("headless", True),
            stealth=config.get("stealth", True),
            proxy=config.get("proxy")
        )
        self.active_sessions[session_id] = engine

        try:
            yield session_id, engine
        finally:
            await engine.close()
            del self.active_sessions[session_id]

    async def run_isolated_task(self, task: str, config: dict = {}) -> dict:
        """Each task runs in a fully isolated browser context"""
        async with self.create_session(config) as (session_id, engine):
            agent = AutomationAgent(
                ai_router=AIRouter(...),
                browser=engine,
                action_executor=ActionExecutor(engine, DOMInteractor(engine.page))
            )
            return await agent.run(task)
```

---

## 12. Security Architecture

| Threat | Mitigation |
|---|---|
| **Prompt injection via web page** | Sanitize DOM content before passing to LLM; never execute JS from LLM verbatim without validation |
| **Credential leakage** | Secrets stored in env vars / vault; never passed in LLM messages |
| **Malicious redirects** | URL allowlist/blocklist enforcement before navigation |
| **XSS via DOM extraction** | HTML is parsed and serialized to Markdown before LLM injection |
| **Resource exhaustion** | Max step limit, session timeout, concurrent session cap |
| **Browser fingerprinting** | Stealth mode, rotating user agents, randomized viewport sizes |
| **API key exposure** | API keys never appear in agent conversation history |

```python
class SecurityFilter:
    BLOCKED_DOMAINS = {"evil.com", "malware.xyz"}
    ALLOWED_JS_PATTERNS = [r"^window\.scrollBy\(", r"^document\.querySelectorAll\("]

    def validate_url(self, url: str) -> bool:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.netloc in self.BLOCKED_DOMAINS:
            raise SecurityError(f"Blocked domain: {parsed.netloc}")
        return True

    def sanitize_dom_for_llm(self, dom_text: str) -> str:
        """Remove potential prompt injection attempts from page content"""
        injection_patterns = [
            r"ignore previous instructions",
            r"you are now",
            r"system:",
            r"<\|.*?\|>",
        ]
        for pattern in injection_patterns:
            dom_text = re.sub(pattern, "[REDACTED]", dom_text, flags=re.IGNORECASE)
        return dom_text

    def validate_action(self, action_name: str, params: dict) -> bool:
        if action_name == "execute_js":
            script = params.get("script", "")
            if not any(re.match(p, script) for p in self.ALLOWED_JS_PATTERNS):
                raise SecurityError(f"Unauthorized JS: {script[:100]}")
        return True
```

---

## 13. Observability & Tracing

```python
import time
from prometheus_client import Counter, Histogram, Gauge

# Metrics
TASK_COUNTER = Counter("automation_tasks_total", "Total tasks executed", ["status"])
STEP_HISTOGRAM = Histogram("automation_steps_per_task", "Steps taken per task", buckets=[1,2,5,10,15,20,30])
LLM_LATENCY = Histogram("llm_request_duration_seconds", "LLM API latency", ["provider", "model"])
ACTIVE_SESSIONS = Gauge("automation_active_sessions", "Currently active browser sessions")

class TracedAgent(AutomationAgent):
    async def run(self, task: str) -> dict:
        start = time.time()
        ACTIVE_SESSIONS.inc()
        try:
            result = await super().run(task)
            status = "success" if result["success"] else "failure"
            TASK_COUNTER.labels(status=status).inc()
            STEP_HISTOGRAM.observe(result["steps"])
            return result
        except Exception as e:
            TASK_COUNTER.labels(status="error").inc()
            raise
        finally:
            ACTIVE_SESSIONS.dec()
```

---

## 14. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Language** | Python 3.12+ | Core framework |
| **Async Runtime** | asyncio + uvloop | High-performance async execution |
| **Browser Control** | Playwright (primary), Puppeteer (Node.js alt) | Page interaction and CDP access |
| **Local LLM** | Ollama 0.3+ | Local model serving with OpenAI API compat |
| **Cloud LLM** | NVIDIA NIM API | TensorRT-optimized cloud inference |
| **Vision** | LLaVA, Phi-3-Vision (via Ollama), NVLM-D (via NIM) | Screenshot understanding |
| **DOM Parsing** | BeautifulSoup4, Playwright AX Tree API | Page content extraction |
| **Image Processing** | Pillow | SOM annotation, screenshot manipulation |
| **Short-term Memory** | Redis 7+ | Session state, DOM caching |
| **Long-term Memory** | Qdrant | Vector similarity search |
| **Embeddings** | nomic-embed-text (Ollama), nv-embedqa-e5-v5 (NIM) | Semantic memory encoding |
| **API Server** | FastAPI + Uvicorn | REST/WebSocket task submission |
| **Task Queue** | Celery + Redis | Async task distribution |
| **Observability** | Prometheus + Grafana | Metrics and dashboards |
| **Tracing** | OpenTelemetry + Jaeger | Distributed request tracing |
| **Containerization** | Docker + Docker Compose | Deployment and isolation |

---

## 15. Data Flow Diagrams

### Complete Single-Step Execution Flow

```
User Task (natural language)
    │
    ▼
[Task Planner]
    │ Decomposes into sub-goals
    ▼
[Memory Lookup] ──── Similar past tasks? ────► Use stored action sequence
    │  No match
    ▼
[Browser Engine] ── Takes screenshot + accessibility tree
    │
    ▼
[DOM Serializer] ── Converts page to compact LLM-readable format
    │
    ▼
[Security Filter] ── Sanitizes DOM content
    │
    ▼
[AI Router] ─────── Selects Ollama or NIM based on strategy
    │
    ▼
[LLM Request] ───── messages + tools + DOM state
    │
    ▼
[Response Parser] ─── Extracts tool_call (action + params)
    │
    ▼
[Action Validator] ── Security check on action params
    │
    ▼
[Action Executor] ─── Executes on real browser
    │
    ▼
[Observation Builder] ─── Captures result + new page state
    │
    ▼
[Memory Update] ──── Stores step to Redis
    │
    ▼
─── Loop back to DOM capture for next step ───
    │
    ▼ (when action == "finish")
[Result Aggregator] ─── Compile task result
    │
    ▼
[Memory Consolidation] ─── Store successful pattern to Qdrant
    │
    ▼
Return result to user
```

---

## 16. Configuration Reference

```yaml
# config.yaml

ai:
  strategy: local_first          # local_first | cloud_first | performance | cost_optimal
  ollama:
    base_url: http://localhost:11434
    default_model: llama3.2
    vision_model: llava:13b
    timeout_seconds: 60
    options:
      temperature: 0.1
      num_ctx: 8192
  nim:
    api_key: ${NIM_API_KEY}
    base_url: https://integrate.api.nvidia.com/v1
    default_model: meta/llama-3.1-70b-instruct
    vision_model: meta/llama-3.2-90b-vision-instruct
    max_tokens: 4096

browser:
  headless: true
  stealth: true
  viewport:
    width: 1280
    height: 900
  timeout_ms: 30000
  navigation_wait: domcontentloaded

agent:
  max_steps: 30
  enable_vision: true
  dom_mode: accessibility_tree    # accessibility_tree | markdown | som | combined

memory:
  redis_url: redis://localhost:6379
  qdrant_url: http://localhost:6333
  session_ttl_seconds: 3600
  enable_long_term: true

security:
  allowed_domains: []             # empty = allow all
  blocked_domains:
    - malware.xyz
  max_concurrent_sessions: 10
  enable_prompt_injection_filter: true

observability:
  prometheus_port: 8000
  log_level: INFO
  trace_llm_calls: true
```

---

## 17. Deployment Architecture

### Docker Compose (Development)

```yaml
version: "3.9"
services:
  automation-api:
    build: .
    ports: ["8080:8080"]
    environment:
      - NIM_API_KEY=${NIM_API_KEY}
      - OLLAMA_BASE_URL=http://ollama:11434
      - REDIS_URL=redis://redis:6379
      - QDRANT_URL=http://qdrant:6333
    depends_on: [ollama, redis, qdrant]

  ollama:
    image: ollama/ollama:latest
    ports: ["11434:11434"]
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              capabilities: [gpu]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  qdrant:
    image: qdrant/qdrant:latest
    ports: ["6333:6333"]
    volumes:
      - qdrant_data:/qdrant/storage

  prometheus:
    image: prom/prometheus:latest
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:latest
    ports: ["3000:3000"]

volumes:
  ollama_data:
  qdrant_data:
```

### Production Architecture

```
                        ┌─────────────────────────────────┐
                        │         Load Balancer            │
                        │     (Nginx / AWS ALB)            │
                        └────────────┬────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                       │
    ┌─────────▼─────┐    ┌──────────▼────────┐    ┌────────▼──────┐
    │ API Server 1  │    │  API Server 2      │    │  API Server N │
    │ (FastAPI)     │    │  (FastAPI)         │    │  (FastAPI)    │
    └───────┬───────┘    └──────────┬─────────┘    └────────┬──────┘
            └──────────────────┬────┘                        │
                               │                             │
                    ┌──────────▼──────────┐                  │
                    │   Celery Workers     │◄─────────────────┘
                    │   (Browser Pool)     │
                    └──────────┬──────────┘
                               │
               ┌───────────────┼────────────────┐
               │               │                │
    ┌──────────▼──┐  ┌─────────▼─────┐  ┌───────▼───────┐
    │  Ollama     │  │   NVIDIA NIM  │  │  Redis Cluster│
    │  (GPU Node) │  │   (API)       │  │  + Qdrant     │
    └─────────────┘  └───────────────┘  └───────────────┘
```

---

## 18. Extending the System

### Adding a New Action

1. Add JSON schema entry to the tools list in `actions/schema.json`
2. Implement `_action_<name>` in `ActionExecutor`
3. No other changes needed — the LLM will automatically use the new tool

### Adding a New AI Provider

```python
class AnthropicProvider:  # Example extension
    async def chat(self, messages, tools=None) -> dict:
        # Implement OpenAI-compatible response format
        ...

# Register in AIRouter
router = AIRouter(
    providers={
        "ollama": OllamaProvider(),
        "nim": NIMProvider(api_key="..."),
        "anthropic": AnthropicProvider(api_key="..."),  # New provider
    },
    strategy=ProviderStrategy.LOCAL_FIRST
)
```

### Adding a Custom DOM Strategy

```python
class CustomDOMStrategy(DOMSerializer):
    async def page_to_markdown(self, page) -> str:
        # Override with domain-specific extraction logic
        # E.g., specialized parsing for e-commerce product pages
        ...
```

---

## Appendix: Key Design Principles

**1. DOM First, Vision Second.** Accessibility tree extraction is faster and more reliable than VLM screenshot analysis. Vision is used as a fallback when DOM is insufficient (e.g., canvas-based UIs, complex visual components).

**2. Low Temperature by Default.** Automation requires deterministic, predictable behavior. Use `temperature=0.0–0.1` for action selection and only increase it for open-ended extraction tasks.

**3. Observation-Driven Loops.** Every action produces an observation that feeds back into the LLM context. The system is stateless between steps — the full context window is the system's "working memory" for a task.

**4. Fail Fast, Retry Smart.** Failed actions are immediately reported to the LLM as observations. The LLM is responsible for deciding to retry, try an alternative, or abandon the sub-task.

**5. Provider Agnostic Core.** The action schema, DOM engine, and memory layer have zero dependency on which AI provider is used. Providers are pluggable at the routing layer.

**6. Security is Structural.** Prompt injection protection, URL validation, and JS execution guards are not optional middleware — they are structural components of the pipeline that run on every step.

---

*Generated for production reference. All code examples are Python 3.12+ with asyncio. Playwright 1.45+, Ollama 0.3+, and NVIDIA NIM API v1 compatible.*
