/**
 * 将文本列表按总字符上限分块。
 * @param {string[]} texts 文本列表
 * @param {number} maxChars 每块最大字符数
 * @param {number} [maxItems] 每块最大条数
 * @returns {string[][]} 分块结果
 */
function chunkTexts(texts, maxChars, maxItems) {
  if (maxChars == null) maxChars = 4000;
  if (maxItems == null) maxItems = 40;
  const chunks = [];
  let current = [];
  let size = 0;
  for (const t of texts) {
    const len = t.length;
    const overflowChars = current.length && size + len > maxChars;
    const overflowItems = current.length >= maxItems;
    if (overflowChars || overflowItems) {
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
 * @param {{ translateTexts: Function, maxChunkChars?: number, maxChunkItems?: number }} provider 引擎
 * @param {string[]} texts 文本
 * @param {{ targetLang: string }} options 选项
 * @returns {Promise<string[]>}
 */
async function translateAllTexts(provider, texts, options) {
  if (!texts.length) return [];
  // 外层粗分块；AI 引擎可声明更大 maxChunk* 以减少请求次数
  const maxChars =
    provider && provider.maxChunkChars != null ? provider.maxChunkChars : 4000;
  const maxItems =
    provider && provider.maxChunkItems != null ? provider.maxChunkItems : 40;
  const chunks = chunkTexts(texts, maxChars, maxItems);
  const out = [];
  for (const chunk of chunks) {
    const part = await provider.translateTexts(chunk, options);
    if (!Array.isArray(part) || part.length !== chunk.length) {
      throw new Error("翻译结果数量与原文不一致");
    }
    out.push.apply(out, part);
  }
  return out;
}

/**
 * 翻译整封邮件主题与 HTML 正文。
 * @param {object} provider 引擎
 * @param {{ subject: string, html: string }} message 邮件内容
 * @param {{ targetLang: string }} options 选项
 * @returns {Promise<{ subject: string, html: string }>}
 */
async function translateMessageContent(provider, message, options) {
  const subject = message.subject || "";
  const extracted = extractTextSegments(message.html || "");
  const segments = extracted.segments;
  const skeleton = extracted.skeleton;
  const toTranslate = subject.trim() ? [subject].concat(segments) : segments.slice();
  if (!toTranslate.length) {
    throw new Error("没有可翻译的正文");
  }
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
 * @param {object} settings 设置
 * @returns {object} provider
 */
function createProvider(settings) {
  const check = validateSettingsForEngine(settings);
  if (!check.ok) {
    throw new Error(check.error);
  }
  if (settings.engine === "microsoft-free") {
    return MicrosoftFreeProvider;
  }
  if (settings.engine === "microsoft-azure") {
    return createMicrosoftAzureProvider(settings);
  }
  if (settings.engine === "openai") {
    return createOpenAICompatibleProvider(settings);
  }
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
