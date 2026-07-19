# ATN 商店文案（addons.thunderbird.net）

提交时直接复制下列字段。英文为主，中文可放在 Additional Information。

## 基本信息

| 字段 | 值 |
|------|-----|
| 名称 (en) | Mail Translate |
| 名称 (zh) | 邮件翻译 |
| 扩展 ID | `mail-translate@uuyo.pw` |
| 当前版本 | 0.1.6 |
| 最低版本 | Thunderbird 128.0 |
| 分类建议 | Messages and News / Language tools |
| 隐私政策 URL | 将仓库内 `privacy.html` 托管到你的 HTTPS 站点后填入（必填） |

## Summary（英文，约 250 字符内）

Translate the subject and full body of the message you are reading, with one-click switch back to the original. Default Microsoft Translator needs no setup; optional Azure or custom OpenAI-compatible AI.

## Description（英文）

Mail Translate helps you read mail written in another language without leaving Thunderbird.

**Features**
- Manual translation of the currently displayed message (subject + body)
- Keeps HTML structure where possible
- Toggle original translation in the reading pane (does not modify the message on the server)
- Default engine: Microsoft Translator (no API key)
- Optional: Microsoft Azure Translator or any OpenAI-compatible chat API
- Custom AI batches many text segments into one request to reduce latency
- Global target language in the options page
- Toolbar button state follows the selected message

**Privacy**
- Message content is sent only to the translation service you select
- API keys stay on your device
- No developer relay server, no analytics

**Limitations**
- The free Microsoft path uses Microsoft edge/auth endpoints and may be rate-limited or change without notice
- Compose-window translation, auto-translate-all, and side-by-side view are not included yet

**Permissions**
- Read/modify displayed messages (local view only)
- Storage for settings
- Host access to Microsoft Translator endpoints
- Optional host access for your custom AI Base URL (requested when you save/test)

## 中文简介（可选）

阅读邮件时一键全文翻译主题与正文，支持原文/译文切换。默认微软翻译免配置，也可使用 Azure 或自定义 OpenAI 兼容 AI。邮件内容仅发送到你选择的服务，密钥只保存在本机。

## 审核备注（给审稿人，英文）

```
Thanks for reviewing.

Default path uses Microsoft Translator free token endpoint
(edge.microsoft.com/translate/auth) + Cognitive Translator APIs.
Azure and custom AI are opt-in in Options.

Custom AI does not use <all_urls>. Host permission is requested
at runtime for the configured Base URL origin only.

Source is plain JS MailExtension (MV2), no minified obfuscation.
Test: open a message -> click Translate -> toggle original.
Options: choose engine -> Test connection.
```

## 截图建议

1. 阅读窗工具栏 Translate / 翻译按钮
2. 译文替换后的正文
3. 设置页：引擎与目标语言
4. 自定义 AI 配置（可选）

## 提交步骤

见同目录 SUBMIT.md。