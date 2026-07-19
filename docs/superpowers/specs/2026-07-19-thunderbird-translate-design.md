# Thunderbird 全文替换翻译插件 — 设计规格

**日期：** 2026-07-19  
**状态：** 已定稿（头脑风暴确认）  
**产品名（暂定）：** Thunderbird Translate / 邮件翻译

---

## 1. 背景与目标

在 Thunderbird 阅读收到的邮件时，一键将**主题 + 正文**全文替换为译文，并支持在原文/译文之间切换。默认使用**免配置的微软翻译**（Edge/Bing 同类接口），同时支持**自定义 OpenAI 兼容 AI**（端点、API Key、模型 ID）。

### 1.1 成功标准

- 用户安装扩展后，无需任何密钥即可用微软引擎翻译外文邮件。
- 点击工具栏按钮后，阅读窗内主题与正文被译文替换，HTML 结构尽量保留。
- 同一封邮件可一键在原文与译文之间切换，且不修改服务器/本地存储中的原邮件。
- 用户可在设置中切换为自定义 AI，并填写端点、Key、模型 ID。
- 目标语言可在设置页全局选择。

### 1.2 非目标（首版不做）

- 写信/回复时的草稿翻译
- 打开邮件自动翻译
- 原文/译文对照（并排或上下）模式
- 离线本地模型
- 翻译列表中的主题（仅阅读窗显示）
- 附件名、日历、新闻组等其他对象
- 多引擎自由组合以外的 Google/DeepL 等（后续可扩展接口）

---

## 2. 用户决策摘要

| 决策项 | 选择 |
|--------|------|
| 使用场景 | 仅翻译**收到的邮件**（阅读时） |
| 替换方式 | **全文替换**显示 |
| 翻译范围 | **正文 + 主题** |
| 原文查看 | **一键切换** 原文 ⇄ 译文 |
| 触发方式 | **仅手动**点击按钮 |
| 目标语言 | 设置页**全局选择** |
| 引擎 | **微软免 Key（默认）** + **自定义 OpenAI 兼容 AI**；Azure 官方 Key 为可选高级项 |
| 架构路线 | **标准 MailExtension** + 阅读窗就地替换 |

---

## 3. 架构总览

采用 Thunderbird **MailExtensions**（WebExtension 兼容模型）。

```
用户点击「翻译」
        │
        ▼
┌───────────────────┐
│  background.js    │  调度中心：读设置、取邮件、调引擎、回传结果
└─────────┬─────────┘
          │
          ├──────────────► MicrosoftFreeProvider（默认，免 Key）
          ├──────────────► MicrosoftAzureProvider（可选高级）
          └──────────────► OpenAICompatibleProvider（自定义 AI）
          │
          ▼
┌───────────────────┐
│ message-display   │  缓存原文、替换主题/正文文本节点、切换显示
└───────────────────┘
          ▲
┌───────────────────┐
│ options 设置页    │  引擎、目标语言、微软高级、AI 配置、测试连接
└───────────────────┘
          ▲
┌───────────────────┐
│ messageDisplayAction │ 工具栏按钮与状态文案
└───────────────────┘
```

### 3.1 组件职责

| 模块 | 文件（规划） | 职责 |
|------|----------------|------|
| 后台调度 | `src/background/background.js` | 消息路由、当前标签邮件上下文、调用翻译服务 |
| 翻译服务 | `src/background/translate-service.js` | 选择引擎、分块、合并、错误归一化 |
| 微软免 Key | `src/background/providers/microsoft-free.js` | Edge/Bing 风格免费接口 |
| 微软 Azure | `src/background/providers/microsoft-azure.js` | 官方 Translator REST（可选） |
| OpenAI 兼容 | `src/background/providers/openai-compatible.js` | Chat Completions 翻译 |
| HTML 处理 | `src/shared/html-text.js` | 抽取/回填文本节点、跳过 script/style |
| 阅读窗脚本 | `src/content/message-display.js` | 替换 DOM、缓存、切换 |
| 设置页 | `src/options/options.html` + `.js` + `.css` | 配置 UI |
| 清单 | `manifest.json` | 权限、入口、兼容版本 |
| 本地化 | `_locales/zh_CN/messages.json` 等 | UI 文案 |

### 3.2 进程边界

- **网络请求**只在 background 发起（避免阅读窗 CSP/跨域限制）。
- **DOM 操作**只在 message-display 脚本中进行。
- **配置**存 `browser.storage.local`，仅本地使用，不上传到本扩展作者服务器。

---

## 4. 翻译引擎设计

### 4.1 统一 Provider 接口

```ts
// 逻辑接口（实现为 JS 模块导出）
interface TranslateProvider {
  id: string;
  name: string;
  /** 翻译纯文本数组，与输入顺序一致返回 */
  translateTexts(texts: string[], options: {
    targetLang: string;
    sourceLang?: string; // 默认 auto
  }): Promise<string[]>;
}
```

所有引擎只处理**纯文本片段**；HTML 的拆分与回填由 `html-text` 完成，避免把标签发给引擎。

### 4.2 微软免 Key（默认）

- **行为：** 零配置可用；源语言 auto；目标语言来自设置。
- **实现思路：** 使用与常见开源库/IDE 插件同类的 Microsoft Edge/Bing Translator 公开接口（含鉴权 token 获取 + 批量 translate）。
- **风险：** 非官方，可能变更路径/签名/限流。必须：
  - 错误时给出明确中文提示；
  - 提供「改用自定义 AI」或「配置 Azure」出口；
  - 代码集中在单一模块，便于日后替换端点逻辑。
- **分块：** 按字符数与条目数分块（具体阈值实现时按接口限制设定，如单次总字符上限），块间串行或有限并发，合并时保持顺序。

### 4.3 微软 Azure（可选高级）

- 端点：`https://api.cognitive.microsofttranslator.com/translate`
- 用户配置：订阅密钥、区域 `region`
- 请求头：`Ocp-Apim-Subscription-Key`、`Ocp-Apim-Subscription-Region`
- 仅在用户选择该模式并填写 Key 后使用

### 4.4 自定义 AI（OpenAI 兼容）

- 用户配置：`baseUrl`、`apiKey`、`modelId`
- 请求：`POST {baseUrl}/chat/completions`（若 baseUrl 已含路径则按用户填写规范化，避免双斜杠）
- 系统提示约束：
  - 只输出译文，不要解释、不要 markdown 代码围栏；
  - 尽量保持段落与换行；
  - 专有名词可保留原文若无法确定。
- 用户消息：待译文本；多段时可编号列表翻译后解析，或逐段请求。
- 长文本：按字符阈值分片，保序拼接。

### 4.5 引擎选择逻辑

```
settings.engine === 'microsoft-free'  → MicrosoftFreeProvider
settings.engine === 'microsoft-azure' → MicrosoftAzureProvider（校验 Key）
settings.engine === 'openai'          → OpenAICompatibleProvider（校验三项配置）
```

设置页展示：

1. **微软翻译（默认，免配置）**
2. **微软 Azure（需密钥）**
3. **自定义 AI（OpenAI 兼容）**

### 4.6 设置项清单

| 键 | 类型 | 默认 | 说明 |
|----|------|------|------|
| `engine` | string | `microsoft-free` | 当前引擎 |
| `targetLang` | string | `zh-Hans` | 目标语言 BCP-47/微软代码 |
| `azureKey` | string | `""` | Azure 密钥 |
| `azureRegion` | string | `""` | Azure 区域 |
| `openaiBaseUrl` | string | `""` | AI 端点 |
| `openaiApiKey` | string | `""` | AI Key |
| `openaiModel` | string | `""` | 模型 ID |

另提供「测试连接」：用短句 `Hello` → 目标语言，成功/失败 toast 或页面内提示。

### 4.7 目标语言列表（首版）

至少包含：`zh-Hans`、`zh-Hant`、`en`、`ja`、`ko`、`fr`、`de`、`es`、`ru`。  
设置页用中文标签展示（如「简体中文」）。

### 4.8 源语言

始终 auto。若检测结果与目标语言相同（微软接口若返回 detectedLanguage），可提示「内容似乎已是目标语言」仍允许强制翻译；首版简化为直接翻译不拦截。

---

## 5. 全文替换与原文切换

### 5.1 显示行为

| 用户操作 | 结果 |
|----------|------|
| 未翻译时点「翻译」 | 请求翻译 → 阅读窗主题与正文替换为译文 |
| 已显示译文时点「显示原文」 | 从缓存恢复原文显示 |
| 已显示原文时点「显示译文」 | 从缓存恢复译文（不重复请求） |
| 切换到另一封邮件 | 清空上一封 UI 状态；新邮件从「未翻译」开始 |
| 关闭阅读窗 | 丢弃该 messageId 缓存 |

### 5.2 不修改原邮件

仅修改**当前阅读窗 DOM/显示层**。不调用会改写 message store 的 API。用户刷新/重开邮件看到的是原件。

### 5.3 正文替换策略

1. 获取邮件 HTML（或纯文本包装为简单 HTML）。
2. `extractTextNodes(html)` → 有序文本片段列表（过滤空白-only 可选保留结构空格策略：空白-only 节点不送译、保留原样）。
3. `provider.translateTexts(segments)` → 译文列表。
4. `applyTranslations(html, translations)` → 新 HTML。
5. 注入阅读窗：替换 body 内容（或 Thunderbird 提供的 message display 文档根）。

跳过：`script`、`style`、`noscript`、`textarea`（若有）、注释节点。

### 5.4 主题

- 翻译前读取当前消息 `subject`。
- 译文写回阅读窗可见的主题展示区域（以 Thunderbird messageDisplay API 实际能力为准；若无法改系统主题栏，则在正文顶部插入「主题译文」条，但优先尝试替换显示主题）。
- **首版明确：列表主题不改。**

### 5.5 缓存结构（内存，background 或 content 择一，推荐 background 统一）

```js
// key: tabId + messageId 或 messageId
{
  messageId,
  original: { subject, html },
  translated: { subject, html },
  view: 'original' | 'translated'
}
```

### 5.6 按钮状态机

```
idle ──translate──► loading ──ok──► showing_translated
                         │ fail
                         ▼
                       idle(+错误提示)

showing_translated ──toggle──► showing_original ──toggle──► showing_translated
```

按钮文案：

- idle：`翻译`
- loading：`翻译中…`（禁用重复点击）
- showing_translated：`显示原文`
- showing_original：`显示译文`

---

## 6. 消息与 API 契约（扩展内部）

### 6.1 content → background

| type | payload | 响应 |
|------|---------|------|
| `GET_SETTINGS` | — | settings 对象 |
| `TRANSLATE_MESSAGE` | `{ messageId, subject, html, targetLang? }` | `{ subject, html }` 或 `{ error }` |
| `TEST_ENGINE` | `{ engine, ...creds }` | `{ ok, sample? , error? }` |

### 6.2 background → content

| type | payload |
|------|---------|
| `APPLY_TRANSLATION` | `{ subject, html }` |
| `APPLY_ORIGINAL` | `{ subject, html }` |
| `SET_STATUS` | `{ state, message? }` |

具体以 Thunderbird `browser.runtime.sendMessage` / `tabs.sendMessage` 实现；messageDisplay 脚本注册监听。

### 6.3 Thunderbird 平台 API（预期使用）

- `browser.messageDisplay.getDisplayedMessage(tabId)`
- `browser.messages.getFull(messageId)` 或 `getRaw` / parts 获取正文
- `browser.messageDisplayAction` 按钮与 onClicked
- `browser.storage.local`
- `browser.menus`（可选，首版可不做右键菜单）
- permissions：`messagesRead`、`storage`、必要 `host_permissions`（微软与用户自定义 AI 域名；自定义 AI 可用 optional 或 `<all_urls>` 视审核策略，首版对自定义 baseUrl 使用 `host_permissions` 通配需在文档说明：开发期可用 `*://*/*`，上架前收紧）

**权限策略（首版开发）：**

- `messagesRead`、`storage`
- `host_permissions`:  
  - 微软相关域名（token + translate）  
  - `*://*/*` 用于自定义 AI 任意端点（在 README 说明隐私影响）

---

## 7. 错误处理

| 场景 | 用户可见行为 |
|------|----------------|
| 网络失败 | 「网络错误，请稍后重试」 |
| 微软免 Key 限流/接口变更 | 「微软免费接口暂时不可用，请改用自定义 AI 或 Azure」 |
| Azure Key 无效 | 「Azure 密钥或区域无效」 |
| AI 401/403 | 「API Key 无效或无权访问」 |
| AI 端点不可达 | 「无法连接自定义 AI 端点」 |
| 空正文 | 「没有可翻译的正文」 |
| 翻译超时 | 「翻译超时，请缩短邮件或稍后重试」 |
| 部分块失败 | 整体失败回滚，不半替换；提示错误 |

超时：单次请求建议 30–60s；loading 可取消（首版可不做取消，仅防重复点击）。

---

## 8. UI 设计

### 8.1 工具栏

- `messageDisplayAction` 图标 + 标题「翻译」
- 根据状态更新 title/label（若 API 支持）

### 8.2 设置页分区

1. 通用：引擎单选、目标语言下拉  
2. 微软 Azure（折叠/仅选中时显示）  
3. 自定义 AI（选中时显示）  
4. 测试连接按钮 + 结果区  
5. 简短说明：默认微软免配置；邮件仅本地显示替换；Key 仅存本机  

### 8.3 语言

- UI 默认中文  
- `_locales` 提供 zh_CN（及可选 en）

---

## 9. 安全与隐私

- 邮件正文仅发送到用户选择的翻译服务（微软或用户自填 AI 端点），不经过第三方中继（扩展作者服务器）。
- 密钥存 `storage.local`，不写日志明文（调试日志需脱敏）。
- README 明确告知：使用在线翻译即同意将内容发送至对应服务商。

---

## 10. 测试策略

### 10.1 单元测试（Node）

- `html-text`：抽取/回填往返保持结构；跳过 script/style  
- 分块合并逻辑顺序正确  
- settings 校验（缺 Key 时拒绝 Azure/AI）

### 10.2 手工测试（Thunderbird）

- 纯文本英→中  
- 简单 HTML（加粗、链接）结构保留  
- 长邮件分块  
- 原文/译文切换  
- 切换邮件后状态重置  
- 微软免 Key 成功路径  
- 自定义 AI（可用 mock 或本地兼容服务）  
- 错误路径：断网、错误 Key  

### 10.3 自动化扩展测试

首版不强制 web-ext 自动化；提供 `web-ext run` 本地加载说明。

---

## 11. 项目结构（落地）

```
Thunderbird翻译插件/
├── manifest.json
├── README.md
├── package.json
├── .gitignore
├── src/
│   ├── background/
│   │   ├── background.js
│   │   ├── translate-service.js
│   │   └── providers/
│   │       ├── microsoft-free.js
│   │       ├── microsoft-azure.js
│   │       └── openai-compatible.js
│   ├── content/
│   │   └── message-display.js
│   ├── options/
│   │   ├── options.html
│   │   ├── options.js
│   │   └── options.css
│   ├── shared/
│   │   ├── html-text.js
│   │   ├── languages.js
│   │   └── settings.js
│   └── icons/
│       └── icon-*.png
├── _locales/
│   └── zh_CN/messages.json
├── tests/
│   └── html-text.test.js
└── docs/superpowers/
    ├── specs/2026-07-19-thunderbird-translate-design.md
    └── plans/2026-07-19-thunderbird-translate.md
```

---

## 12. 兼容性

- 目标：Thunderbird **128+** ESR / 近期正式版（MailExtension 稳定 API）
- `manifest_version`: 2（Thunderbird 当前主流；若目标版本支持 MV3 再评估）
- 在 manifest 中声明 `browser_specific_settings.gecko` / `thunderbird` 严格最小版本

---

## 13. 实现优先级

1. 扩展骨架 + 设置存储 + 按钮  
2. HTML 文本抽取/回填 + 单元测试  
3. 微软免 Key 引擎 + 阅读窗替换  
4. 原文/译文切换  
5. 主题翻译  
6. 自定义 AI 引擎  
7. Azure 可选引擎 + 测试连接  
8. README 与打包说明  

---

## 14. 开放问题（已关闭）

| 问题 | 结论 |
|------|------|
| 微软是否必须 Azure Key？ | **否**，默认免 Key；Azure 可选 |
| 是否改原邮件？ | **否**，仅显示层 |
| 是否自动翻译？ | **否**，首版仅手动 |

---

## 15. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-19 | 初稿：头脑风暴定稿，微软改为默认免 Key |
