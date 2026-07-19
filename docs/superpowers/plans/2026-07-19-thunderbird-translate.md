# Thunderbird 全文替换翻译插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Thunderbird MailExtension：阅读收到的邮件时手动一键全文替换翻译主题与正文，支持微软免 Key 与自定义 OpenAI 兼容 AI，并可在原文/译文间切换。

**Architecture:** 后台 `background` 负责取信、调翻译引擎、缓存；`message-display` 脚本负责 DOM 替换与切换；设置存 `storage.local`；引擎以统一 Provider 接口可插拔（microsoft-free / microsoft-azure / openai）。

**Tech Stack:** Thunderbird MailExtensions（manifest v2）、原生 JS、Node 内置测试（`node --test`）、可选 `web-ext` 本地加载。

**规格依据：** `docs/superpowers/specs/2026-07-19-thunderbird-translate-design.md`

---

## 文件结构（锁定）

| 路径 | 职责 |
|------|------|
| `manifest.json` | 扩展清单、权限、入口 |
| `src/background/background.js` | 按钮点击、消息路由、缓存、协调翻译 |
| `src/background/translate-service.js` | 选引擎、分块、调用 Provider |
| `src/background/providers/microsoft-free.js` | 免 Key 微软翻译 |
| `src/background/providers/microsoft-azure.js` | Azure 官方翻译 |
| `src/background/providers/openai-compatible.js` | OpenAI 兼容 Chat Completions |
| `src/shared/html-text.js` | HTML 文本节点抽取/回填 |
| `src/shared/languages.js` | 目标语言列表 |
| `src/shared/settings.js` | 默认设置、读写与校验 |
| `src/content/message-display.js` | 阅读窗替换与显示状态 |
| `src/options/options.html` / `.js` / `.css` | 设置页 |
| `src/icons/icon-48.png` | 工具栏图标 |
| `_locales/zh_CN/messages.json` | 中文文案 |
| `tests/*.test.js` | 单元测试 |
| `package.json` | scripts |
| `README.md` | 安装与使用说明 |
| `.gitignore` | 忽略项 |

---

### Task 1: 仓库骨架与 manifest

**Files:**
- Create: `manifest.json`, `package.json`, `.gitignore`, `_locales/zh_CN/messages.json`

- [ ] **Step 1: 初始化 git（若尚未初始化）**

```powershell
cd "D:\Code\Thunderbird翻译插件"
git status 2>$null; if ($LASTEXITCODE -ne 0) { git init }
```

- [ ] **Step 2: 写入 `.gitignore`**

```gitignore
node_modules/
.superpowers/
*.xpi
.web-extension-id
web-ext-artifacts/
.DS_Store
Thumbs.db
```

- [ ] **Step 3: 写入 `package.json`**

```json
{
  "name": "thunderbird-translate",
  "version": "0.1.0",
  "private": true,
  "description": "Thunderbird 邮件全文替换翻译扩展",
  "scripts": {
    "test": "node --test tests/**/*.test.js",
    "lint": "node --check src/shared/html-text.js && node --check src/shared/settings.js"
  },
  "engines": { "node": ">=18" }
}
```

- [ ] **Step 4: 写入 `manifest.json`**

```json
{
  "manifest_version": 2,
  "name": "__MSG_extensionName__",
  "description": "__MSG_extensionDescription__",
  "version": "0.1.0",
  "default_locale": "zh_CN",
  "applications": {
    "gecko": {
      "id": "translate@local.thunderbird",
      "strict_min_version": "128.0"
    }
  },
  "permissions": [
    "messagesRead",
    "storage",
    "menus",
    "https://*.microsoft.com/*",
    "https://*.bing.com/*",
    "https://api.cognitive.microsofttranslator.com/*",
    "https://*.cognitive.microsofttranslator.com/*",
    "https://edge.microsoft.com/*",
    "https://api-edge.cognitive.microsofttranslator.com/*",
    "<all_urls>"
  ],
  "background": {
    "scripts": [
      "src/shared/languages.js",
      "src/shared/settings.js",
      "src/shared/html-text.js",
      "src/background/providers/microsoft-free.js",
      "src/background/providers/microsoft-azure.js",
      "src/background/providers/openai-compatible.js",
      "src/background/translate-service.js",
      "src/background/background.js"
    ]
  },
  "options_ui": {
    "page": "src/options/options.html",
    "open_in_tab": true
  },
  "message_display_action": {
    "default_title": "__MSG_actionTranslate__",
    "default_icon": "src/icons/icon-48.png"
  },
  "message_display_scripts": [
    { "js": ["src/content/message-display.js"] }
  ],
  "icons": { "48": "src/icons/icon-48.png" }
}
```

> 主机权限字段以 Thunderbird 实际文档为准；若 `permissions` 不接受 URL，改用扩展文档推荐写法。

- [ ] **Step 5: 写入 `_locales/zh_CN/messages.json`**

```json
{
  "extensionName": { "message": "邮件翻译" },
  "extensionDescription": { "message": "阅读邮件时全文替换翻译主题与正文，支持微软翻译与自定义 AI。" },
  "actionTranslate": { "message": "翻译" },
  "actionShowOriginal": { "message": "显示原文" },
  "actionShowTranslated": { "message": "显示译文" },
  "actionTranslating": { "message": "翻译中…" }
}
```

- [ ] **Step 6: 提交**

```powershell
git add .gitignore package.json manifest.json _locales
git commit -m "chore: 初始化扩展骨架与 manifest"
```

---

### Task 2: 共享模块 — 语言列表与设置

**Files:**
- Create: `src/shared/languages.js`
- Create: `src/shared/settings.js`
- Create: `tests/settings.test.js`

- [ ] **Step 1: 写入失败测试 `tests/settings.test.js`**

```js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_SETTINGS,
  validateSettingsForEngine,
  normalizeSettings,
} = require("../src/shared/settings.js");

describe("settings", () => {
  it("默认引擎为 microsoft-free", () => {
    assert.equal(DEFAULT_SETTINGS.engine, "microsoft-free");
  });

  it("microsoft-free 无需密钥", () => {
    const r = validateSettingsForEngine({
      ...DEFAULT_SETTINGS,
      engine: "microsoft-free",
    });
    assert.equal(r.ok, true);
  });

  it("openai 缺少字段时失败", () => {
    const r = validateSettingsForEngine({
      ...DEFAULT_SETTINGS,
      engine: "openai",
      openaiBaseUrl: "",
      openaiApiKey: "",
      openaiModel: "",
    });
    assert.equal(r.ok, false);
  });

  it("normalizeSettings 填充默认目标语言", () => {
    const s = normalizeSettings({});
    assert.equal(s.targetLang, "zh-Hans");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
node --test tests/settings.test.js
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `src/shared/languages.js`**

```js
/**
 * 返回首版支持的目标语言列表。
 * @returns {{ code: string, label: string }[]}
 */
function getTargetLanguages() {
  return [
    { code: "zh-Hans", label: "简体中文" },
    { code: "zh-Hant", label: "繁体中文" },
    { code: "en", label: "英语" },
    { code: "ja", label: "日语" },
    { code: "ko", label: "韩语" },
    { code: "fr", label: "法语" },
    { code: "de", label: "德语" },
    { code: "es", label: "西班牙语" },
    { code: "ru", label: "俄语" },
  ];
}

if (typeof module !== "undefined") {
  module.exports = { getTargetLanguages };
}
```

- [ ] **Step 4: 实现 `src/shared/settings.js`**

```js
/** 默认设置 */
const DEFAULT_SETTINGS = {
  engine: "microsoft-free",
  targetLang: "zh-Hans",
  azureKey: "",
  azureRegion: "",
  openaiBaseUrl: "",
  openaiApiKey: "",
  openaiModel: "",
};

/**
 * 将存储中的对象规范为完整设置。
 * @param {object} raw
 * @returns {object}
 */
function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    engine: src.engine || DEFAULT_SETTINGS.engine,
    targetLang: src.targetLang || DEFAULT_SETTINGS.targetLang,
    azureKey: src.azureKey || "",
    azureRegion: src.azureRegion || "",
    openaiBaseUrl: (src.openaiBaseUrl || "").replace(/\/$/, ""),
    openaiApiKey: src.openaiApiKey || "",
    openaiModel: src.openaiModel || "",
  };
}

/**
 * 校验当前引擎所需配置是否齐全。
 * @param {object} settings
 * @returns {{ ok: boolean, error?: string }}
 */
function validateSettingsForEngine(settings) {
  const s = normalizeSettings(settings);
  if (s.engine === "microsoft-free") return { ok: true };
  if (s.engine === "microsoft-azure") {
    if (!s.azureKey.trim()) return { ok: false, error: "请填写 Azure 订阅密钥" };
    if (!s.azureRegion.trim()) return { ok: false, error: "请填写 Azure 区域（如 eastasia）" };
    return { ok: true };
  }
  if (s.engine === "openai") {
    if (!s.openaiBaseUrl.trim()) return { ok: false, error: "请填写 AI 端点 Base URL" };
    if (!s.openaiApiKey.trim()) return { ok: false, error: "请填写 API Key" };
    if (!s.openaiModel.trim()) return { ok: false, error: "请填写模型 ID" };
    return { ok: true };
  }
  return { ok: false, error: "未知翻译引擎" };
}

/**
 * 从 browser.storage.local 读取设置（扩展环境）。
 * @returns {Promise<object>}
 */
async function loadSettings() {
  const stored = await browser.storage.local.get("settings");
  return normalizeSettings(stored.settings);
}

/**
 * 保存设置。
 * @param {object} settings
 */
async function saveSettings(settings) {
  await browser.storage.local.set({ settings: normalizeSettings(settings) });
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_SETTINGS,
    normalizeSettings,
    validateSettingsForEngine,
    loadSettings,
    saveSettings,
  };
}
```

- [ ] **Step 5: 运行测试确认通过**

```powershell
node --test tests/settings.test.js
```

Expected: PASS

- [ ] **Step 6: 提交**

```powershell
git add src/shared tests/settings.test.js
git commit -m "feat: 添加语言列表与设置校验模块"
```

---

### Task 3: HTML 文本抽取与回填

**Files:**
- Create: `src/shared/html-text.js`
- Create: `tests/html-text.test.js`

- [ ] **Step 1: 写入失败测试**

```js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractTextSegments, applyTextSegments } = require("../src/shared/html-text.js");

describe("html-text", () => {
  it("抽取并回填简单 HTML", () => {
    const html = "<p>Hello <b>World</b></p>";
    const { segments, skeleton } = extractTextSegments(html);
    assert.deepEqual(segments, ["Hello ", "World"]);
    const out = applyTextSegments(skeleton, ["你好 ", "世界"]);
    assert.match(out, /你好/);
    assert.match(out, /世界/);
    assert.match(out, /<b>/);
  });

  it("跳过 script 与 style", () => {
    const html = "<style>.a{}</style><p>Hi</p><script>x=1</script>";
    const { segments } = extractTextSegments(html);
    assert.deepEqual(segments, ["Hi"]);
  });

  it("纯空白片段不进入翻译列表", () => {
    const html = "<p>A</p><p>   </p><p>B</p>";
    const { segments } = extractTextSegments(html);
    assert.deepEqual(segments, ["A", "B"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
node --test tests/html-text.test.js
```

- [ ] **Step 3: 实现 `src/shared/html-text.js`（Node 用 linkedom，扩展内用 DOMParser）**

```js
/**
 * 解析 HTML 为 document。
 * @param {string} html
 */
function parseDocument(html) {
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(html, "text/html");
  }
  const { parseHTML } = require("linkedom");
  return parseHTML(html).document;
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

/**
 * 从 HTML 抽取可翻译文本片段。
 * @param {string} html
 * @returns {{ segments: string[], skeleton: string }}
 */
function extractTextSegments(html) {
  const doc = parseDocument(html || "");
  const segments = [];
  const nodes = [];

  /**
   * 递归收集文本节点。
   * @param {Node} root
   */
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      const parent = root.parentElement;
      if (parent && SKIP.has(parent.tagName)) return;
      const text = root.nodeValue;
      if (text == null || !text.trim()) return;
      nodes.push(root);
      segments.push(text);
      return;
    }
    if (root.nodeType === 1 && SKIP.has(root.tagName)) return;
    const children = root.childNodes ? Array.from(root.childNodes) : [];
    for (const child of children) walk(child);
  }

  walk(doc.body || doc.documentElement);
  nodes.forEach((n, i) => {
    n.nodeValue = "\uE000" + i + "\uE001";
  });
  const root = doc.body || doc.documentElement;
  const skeleton = root ? root.innerHTML : "";
  return { segments, skeleton };
}

/**
 * 将译文写回 skeleton。
 * @param {string} skeleton
 * @param {string[]} translations
 * @returns {string}
 */
function applyTextSegments(skeleton, translations) {
  let out = skeleton;
  for (let i = 0; i < translations.length; i++) {
    const token = "\uE000" + i + "\uE001";
    out = out.split(token).join(translations[i] ?? "");
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { extractTextSegments, applyTextSegments };
}
```

- [ ] **Step 4: 安装依赖并跑通**

```powershell
npm install --save-dev linkedom
node --test tests/html-text.test.js
```

Expected: PASS

- [ ] **Step 5: 提交**

```powershell
git add src/shared/html-text.js tests/html-text.test.js package.json package-lock.json
git commit -m "feat: HTML 文本节点抽取与回填"
```

---

### Task 4: 翻译服务与分块

**Files:**
- Create: `src/background/translate-service.js`
- Create: `tests/translate-chunk.test.js`

- [ ] **Step 1: 实现分块与编排（核心 API）**

```js
/**
 * 将文本列表按总字符上限分块。
 * @param {string[]} texts
 * @param {number} maxChars
 * @returns {string[][]}
 */
function chunkTexts(texts, maxChars = 4000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const t of texts) {
    const len = t.length;
    if (current.length && size + len > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(t);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * 使用 provider 翻译全部片段。
 * @param {{ translateTexts: Function }} provider
 * @param {string[]} texts
 * @param {{ targetLang: string }} options
 */
async function translateAllTexts(provider, texts, options) {
  if (!texts.length) return [];
  const chunks = chunkTexts(texts);
  const out = [];
  for (const chunk of chunks) {
    const part = await provider.translateTexts(chunk, options);
    if (!Array.isArray(part) || part.length !== chunk.length) {
      throw new Error("翻译结果数量与原文不一致");
    }
    out.push(...part);
  }
  return out;
}

/**
 * 翻译整封邮件主题与 HTML 正文。
 * @param {object} provider
 * @param {{ subject: string, html: string }} message
 * @param {{ targetLang: string }} options
 */
async function translateMessageContent(provider, message, options) {
  const subject = message.subject || "";
  const { segments, skeleton } = extractTextSegments(message.html || "");
  const toTranslate = subject.trim() ? [subject, ...segments] : [...segments];
  if (!toTranslate.length) throw new Error("没有可翻译的正文");
  const translated = await translateAllTexts(provider, toTranslate, options);
  let newSubject = subject;
  let bodyTranslations = translated;
  if (subject.trim()) {
    newSubject = translated[0];
    bodyTranslations = translated.slice(1);
  }
  return {
    subject: newSubject,
    html: applyTextSegments(skeleton, bodyTranslations),
  };
}

/**
 * 根据设置创建 provider。
 * @param {object} settings
 */
function createProvider(settings) {
  const check = validateSettingsForEngine(settings);
  if (!check.ok) throw new Error(check.error);
  if (settings.engine === "microsoft-free") return MicrosoftFreeProvider;
  if (settings.engine === "microsoft-azure") return createMicrosoftAzureProvider(settings);
  if (settings.engine === "openai") return createOpenAICompatibleProvider(settings);
  throw new Error("未知翻译引擎");
}

if (typeof module !== "undefined") {
  module.exports = {
    chunkTexts,
    translateAllTexts,
    translateMessageContent,
    createProvider,
  };
}
```

> 扩展环境依赖 background 脚本顺序加载全局函数；Node 单测仅测 `chunkTexts`，或在测试里注入 mock。

- [ ] **Step 2: 分块单测**

```js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { chunkTexts } = require("../src/background/translate-service.js");

describe("chunkTexts", () => {
  it("按字符上限分块", () => {
    const chunks = chunkTexts(["aaaa", "bbbb", "c"], 6);
    assert.deepEqual(chunks, [["aaaa"], ["bbbb", "c"]]);
  });
});
```

- [ ] **Step 3: 跑测并提交**

```powershell
node --test tests/translate-chunk.test.js
git add src/background/translate-service.js tests/translate-chunk.test.js
git commit -m "feat: 翻译服务分块与消息编排"
```

---

### Task 5: 微软免 Key Provider

**Files:**
- Create: `src/background/providers/microsoft-free.js`

- [ ] **Step 1: 实现**

```js
/**
 * 微软免 Key 翻译 Provider（Edge/Bing 同类接口）。
 * 注意：非官方接口，可能变更。
 */
const MicrosoftFreeProvider = {
  id: "microsoft-free",
  name: "微软翻译",

  /**
   * @param {string[]} texts
   * @param {{ targetLang: string }} options
   * @returns {Promise<string[]>}
   */
  async translateTexts(texts, options) {
    const targetLang = options.targetLang || "zh-Hans";
    const token = await fetchMicrosoftToken();
    const url =
      "https://api-edge.cognitive.microsofttranslator.com/translate?" +
      new URLSearchParams({
        "api-version": "3.0",
        to: targetLang,
        includeSentenceLength: "true",
      });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(texts.map((Text) => ({ Text }))),
    });
    if (!res.ok) {
      throw new Error(
        "微软免费接口暂时不可用，请改用自定义 AI 或 Azure（HTTP " + res.status + ")"
      );
    }
    const data = await res.json();
    return data.map((item) => item.translations[0].text);
  },
};

/**
 * 获取临时访问令牌。
 * @returns {Promise<string>}
 */
async function fetchMicrosoftToken() {
  const res = await fetch("https://edge.microsoft.com/translate/auth");
  if (!res.ok) {
    throw new Error("无法获取微软翻译令牌，请检查网络或改用其他引擎");
  }
  return await res.text();
}

if (typeof module !== "undefined") {
  module.exports = { MicrosoftFreeProvider, fetchMicrosoftToken };
}
```

- [ ] **Step 2: 网络冒烟（可选）**

```js
const { MicrosoftFreeProvider } = require("./src/background/providers/microsoft-free.js");
MicrosoftFreeProvider.translateTexts(["Hello world"], { targetLang: "zh-Hans" }).then(console.log);
```

- [ ] **Step 3: 提交**

```powershell
git add src/background/providers/microsoft-free.js
git commit -m "feat: 微软免 Key 翻译引擎"
```

---

### Task 6: Azure 与 OpenAI 兼容 Provider

**Files:**
- Create: `src/background/providers/microsoft-azure.js`
- Create: `src/background/providers/openai-compatible.js`

- [ ] **Step 1: Azure Provider**

```js
/**
 * 创建 Azure 官方 Translator Provider。
 * @param {{ azureKey: string, azureRegion: string }} settings
 */
function createMicrosoftAzureProvider(settings) {
  return {
    id: "microsoft-azure",
    name: "微软 Azure",
    async translateTexts(texts, options) {
      const targetLang = options.targetLang || "zh-Hans";
      const url =
        "https://api.cognitive.microsofttranslator.com/translate?" +
        new URLSearchParams({ "api-version": "3.0", to: targetLang });
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": settings.azureKey,
          "Ocp-Apim-Subscription-Region": settings.azureRegion,
        },
        body: JSON.stringify(texts.map((Text) => ({ Text }))),
      });
      if (!res.ok) throw new Error("Azure 密钥或区域无效，或服务暂时不可用");
      const data = await res.json();
      return data.map((item) => item.translations[0].text);
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { createMicrosoftAzureProvider };
}
```

- [ ] **Step 2: OpenAI 兼容 Provider**

```js
/**
 * 创建 OpenAI 兼容 Chat Completions 翻译 Provider。
 * @param {{ openaiBaseUrl: string, openaiApiKey: string, openaiModel: string }} settings
 */
function createOpenAICompatibleProvider(settings) {
  const base = settings.openaiBaseUrl.replace(/\/$/, "");
  const endpoint = base.endsWith("/chat/completions")
    ? base
    : base + "/chat/completions";

  return {
    id: "openai",
    name: "自定义 AI",
    async translateTexts(texts, options) {
      const targetLang = options.targetLang || "zh-Hans";
      const results = [];
      for (const text of texts) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + settings.openaiApiKey,
          },
          body: JSON.stringify({
            model: settings.openaiModel,
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content:
                  "你是翻译引擎。将用户内容翻译为 " +
                  targetLang +
                  "。只输出译文，不要解释，不要使用代码围栏。",
              },
              { role: "user", content: text },
            ],
          }),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("API Key 无效或无权访问");
        }
        if (!res.ok) throw new Error("无法连接自定义 AI 端点或服务返回错误");
        const data = await res.json();
        const content =
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content;
        if (!content) throw new Error("AI 返回空结果");
        results.push(String(content).trim());
      }
      return results;
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { createOpenAICompatibleProvider };
}
```

- [ ] **Step 3: 提交**

```powershell
git add src/background/providers
git commit -m "feat: Azure 与 OpenAI 兼容翻译引擎"
```

---

### Task 7: background 调度、缓存、按钮

**Files:**
- Create: `src/background/background.js`

- [ ] **Step 1: 实现核心逻辑**

要点：

1. `cache: Map`，键 `tabId:messageId`，值 `{ original, translated, view }`
2. `messageDisplayAction.onClicked`：
   - 已译且 showing translated → 发 `APPLY_ORIGINAL`，view=original
   - showing original → 发 `APPLY_TRANSLATION`，view=translated
   - 无缓存 → loading → `getDisplayedMessage` + `messages.getFull` → `createProvider` + `translateMessageContent` → 缓存 → `APPLY_TRANSLATION`
3. 错误：`setTitle` 回 idle，发 `SHOW_ERROR`
4. `onMessage`：`GET_SETTINGS` / `SAVE_SETTINGS` / `TEST_ENGINE`

```js
/** @type {Map<string, any>} */
const cache = new Map();

/**
 * 生成缓存键。
 * @param {number} tabId
 * @param {number|string} messageId
 */
function cacheKey(tabId, messageId) {
  return tabId + ":" + messageId;
}

/**
 * 更新工具栏按钮标题。
 * @param {number} tabId
 * @param {'idle'|'loading'|'translated'|'original'} state
 */
async function setActionState(tabId, state) {
  const titles = {
    idle: browser.i18n.getMessage("actionTranslate") || "翻译",
    loading: browser.i18n.getMessage("actionTranslating") || "翻译中…",
    translated: browser.i18n.getMessage("actionShowOriginal") || "显示原文",
    original: browser.i18n.getMessage("actionShowTranslated") || "显示译文",
  };
  await browser.messageDisplayAction.setTitle({ tabId: tabId, title: titles[state] });
}

/**
 * 从 getFull 结果提取 HTML 或纯文本。
 * @param {any} full
 * @returns {string}
 */
function extractBodyHtml(full) {
  /**
   * @param {any} part
   * @returns {{ html: string|null, text: string|null }}
   */
  function walk(part) {
    if (!part) return { html: null, text: null };
    let html = null;
    let text = null;
    const ct = (part.contentType || "").toLowerCase();
    if (ct.startsWith("text/html") && part.body) html = part.body;
    if (ct.startsWith("text/plain") && part.body) text = part.body;
    if (part.parts) {
      for (const p of part.parts) {
        const r = walk(p);
        html = html || r.html;
        text = text || r.text;
      }
    }
    return { html: html, text: text };
  }
  const got = walk(full);
  if (got.html) return got.html;
  const escaped = (got.text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return '<pre style="white-space:pre-wrap;font-family:inherit">' + escaped + "</pre>";
}

/**
 * 获取当前标签显示的邮件完整内容。
 * @param {number} tabId
 */
async function getDisplayedMessageContent(tabId) {
  const message = await browser.messageDisplay.getDisplayedMessage(tabId);
  if (!message) throw new Error("当前没有打开的邮件");
  const full = await browser.messages.getFull(message.id);
  return {
    messageId: message.id,
    subject: message.subject || "",
    html: extractBodyHtml(full),
  };
}

browser.messageDisplayAction.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  try {
    const content = await getDisplayedMessageContent(tabId);
    const key = cacheKey(tabId, content.messageId);
    const entry = cache.get(key);

    if (entry && entry.view === "translated") {
      await browser.tabs.sendMessage(tabId, {
        type: "APPLY_ORIGINAL",
        subject: entry.original.subject,
        html: entry.original.html,
      });
      entry.view = "original";
      await setActionState(tabId, "original");
      return;
    }
    if (entry && entry.view === "original" && entry.translated) {
      await browser.tabs.sendMessage(tabId, {
        type: "APPLY_TRANSLATION",
        subject: entry.translated.subject,
        html: entry.translated.html,
      });
      entry.view = "translated";
      await setActionState(tabId, "translated");
      return;
    }

    await setActionState(tabId, "loading");
    const settings = await loadSettings();
    const provider = createProvider(settings);
    const translated = await translateMessageContent(provider, content, {
      targetLang: settings.targetLang,
    });
    cache.set(key, {
      messageId: content.messageId,
      original: { subject: content.subject, html: content.html },
      translated: translated,
      view: "translated",
    });
    await browser.tabs.sendMessage(tabId, {
      type: "APPLY_TRANSLATION",
      subject: translated.subject,
      html: translated.html,
    });
    await setActionState(tabId, "translated");
  } catch (e) {
    console.error(e);
    await setActionState(tabId, "idle");
    try {
      await browser.tabs.sendMessage(tabId, {
        type: "SHOW_ERROR",
        message: e.message || "翻译失败",
      });
    } catch (_) {}
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "GET_SETTINGS") return loadSettings();
  if (msg && msg.type === "SAVE_SETTINGS") {
    return saveSettings(msg.settings).then(function () { return { ok: true }; });
  }
  if (msg && msg.type === "TEST_ENGINE") {
    return (async function () {
      try {
        const settings = normalizeSettings(msg.settings);
        const provider = createProvider(settings);
        const out = await provider.translateTexts(["Hello"], {
          targetLang: settings.targetLang,
        });
        return { ok: true, sample: out[0] };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    })();
  }
});
```

- [ ] **Step 2: Thunderbird 临时加载，确认无语法错误**

- [ ] **Step 3: 提交**

```powershell
git add src/background/background.js
git commit -m "feat: 后台调度、缓存与工具栏按钮"
```

---

### Task 8: 阅读窗 content 脚本 + 图标

**Files:**
- Create: `src/content/message-display.js`
- Create: `src/icons/icon-48.png`

- [ ] **Step 1: 实现 message-display.js**

```js
/**
 * 在阅读窗应用 HTML 正文。
 * @param {string} html
 */
function applyBodyHtml(html) {
  let doc = document;
  const iframe = document.querySelector("iframe");
  if (iframe && iframe.contentDocument) doc = iframe.contentDocument;
  if (doc.body) doc.body.innerHTML = html;
}

/**
 * 尝试更新可见主题显示。
 * @param {string} subject
 */
function applySubject(subject) {
  const el =
    document.querySelector(".subject") ||
    document.getElementById("expandedsubjectBox");
  if (el) el.textContent = subject;
  let banner = document.getElementById("tb-translate-subject-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "tb-translate-subject-banner";
    banner.style.cssText =
      "padding:8px 12px;background:#eef;border-bottom:1px solid #ccd;font-weight:600";
    if (document.body) document.body.insertBefore(banner, document.body.firstChild);
  }
  banner.textContent = "主题：" + subject;
}

/**
 * 显示错误提示条。
 * @param {string} message
 */
function showError(message) {
  let bar = document.getElementById("tb-translate-error");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "tb-translate-error";
    bar.style.cssText =
      "padding:8px 12px;background:#fee;color:#900;border-bottom:1px solid #ecc";
    document.body.insertBefore(bar, document.body.firstChild);
  }
  bar.textContent = message;
  setTimeout(function () { bar.remove(); }, 8000);
}

browser.runtime.onMessage.addListener(function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "APPLY_TRANSLATION" || msg.type === "APPLY_ORIGINAL") {
    if (msg.html != null) applyBodyHtml(msg.html);
    if (msg.subject != null) applySubject(msg.subject);
    const err = document.getElementById("tb-translate-error");
    if (err) err.remove();
  }
  if (msg.type === "SHOW_ERROR") showError(msg.message || "翻译失败");
});
```

- [ ] **Step 2: 生成简单 48x48 PNG 图标**

- [ ] **Step 3: Thunderbird 验证替换与切换**

- [ ] **Step 4: 提交**

```powershell
git add src/content src/icons
git commit -m "feat: 阅读窗全文替换与原文切换"
```

---

### Task 9: 设置页

**Files:**
- Create: `src/options/options.html`
- Create: `src/options/options.js`
- Create: `src/options/options.css`

- [ ] **Step 1: HTML**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>邮件翻译设置</title>
  <link rel="stylesheet" href="options.css" />
</head>
<body>
  <h1>邮件翻译设置</h1>
  <section>
    <h2>通用</h2>
    <label>翻译引擎
      <select id="engine">
        <option value="microsoft-free">微软翻译（默认，免配置）</option>
        <option value="microsoft-azure">微软 Azure（需密钥）</option>
        <option value="openai">自定义 AI（OpenAI 兼容）</option>
      </select>
    </label>
    <label>目标语言 <select id="targetLang"></select></label>
  </section>
  <section id="azureSection" hidden>
    <h2>微软 Azure</h2>
    <label>订阅密钥 <input id="azureKey" type="password" autocomplete="off" /></label>
    <label>区域 <input id="azureRegion" placeholder="eastasia" /></label>
  </section>
  <section id="openaiSection" hidden>
    <h2>自定义 AI</h2>
    <label>Base URL <input id="openaiBaseUrl" placeholder="https://api.openai.com/v1" /></label>
    <label>API Key <input id="openaiApiKey" type="password" autocomplete="off" /></label>
    <label>模型 ID <input id="openaiModel" placeholder="gpt-4o-mini" /></label>
  </section>
  <div class="actions">
    <button id="save" type="button">保存</button>
    <button id="test" type="button">测试连接</button>
    <span id="status"></span>
  </div>
  <p class="hint">默认微软翻译无需密钥。邮件内容仅发送至你选择的翻译服务，密钥只保存在本机。</p>
  <script src="../shared/languages.js"></script>
  <script src="../shared/settings.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: options.js**

- 填充 `targetLang` 选项（`getTargetLanguages()`）
- `GET_SETTINGS` 回填表单
- `engine` change 时显示 azure/openai 分区
- 保存：`SAVE_SETTINGS`
- 测试：`TEST_ENGINE`，在 `#status` 显示 sample 或 error

- [ ] **Step 3: 基础 CSS**（max-width、label block、hint 灰色）

- [ ] **Step 4: 手工验证保存与测试连接**

- [ ] **Step 5: 提交**

```powershell
git add src/options
git commit -m "feat: 设置页与测试连接"
```

---

### Task 10: README 与验收

**Files:**
- Create/Modify: `README.md`

- [ ] **Step 1: README 中文内容**

- 功能简介
- 安装：调试附加组件 → 临时加载 manifest 目录
- 使用：打开邮件 → 翻译 → 显示原文
- 设置说明
- 隐私说明
- 开发：`npm test`
- 限制：免 Key 可能变更；不修改原邮件

- [ ] **Step 2: 手工验收清单**

- [ ] 纯文本英→中
- [ ] 简单 HTML 保留加粗/链接
- [ ] 长邮件分块
- [ ] 原文/译文切换
- [ ] 切换邮件状态重置
- [ ] 微软免 Key
- [ ] 自定义 AI（可选）
- [ ] 断网错误提示

- [ ] **Step 3: 提交**

```powershell
git add README.md
git commit -m "docs: 使用与开发说明"
```

---

## 规格覆盖自检

| 规格要求 | 对应 Task |
|----------|-----------|
| 仅收件阅读翻译 | Task 7/8 |
| 全文替换主题+正文 | Task 3/4/7/8 |
| 原文/译文切换 | Task 7/8 |
| 手动触发 | Task 7 |
| 目标语言全局设置 | Task 2/9 |
| 微软免 Key 默认 | Task 5 + 默认 settings |
| Azure 可选 | Task 6/9 |
| 自定义 OpenAI 兼容 | Task 6/9 |
| 错误提示 | Task 7/8 |
| 不改原邮件 | Task 7/8 仅 DOM |
| 单元测试 | Task 2/3/4 |

## Placeholder / 命名一致性

- 引擎 id：`microsoft-free` | `microsoft-azure` | `openai`
- 消息 type：`GET_SETTINGS` | `SAVE_SETTINGS` | `TEST_ENGINE` | `APPLY_TRANSLATION` | `APPLY_ORIGINAL` | `SHOW_ERROR`
- 设置字段与规格 §4.6 一致
- 无 TBD 步骤；Thunderbird DOM 选择器以实机调试微调

---

## 执行交接

Plan 已保存到 `docs/superpowers/plans/2026-07-19-thunderbird-translate.md`。

**执行选项（需你确认后再写代码）：**

1. **Subagent-Driven（推荐）** — 每任务子代理 + 审查
2. **Inline Execution** — 本会话顺序执行

**本次目标：只写设计与实施计划，不启动执行/子代理。**
