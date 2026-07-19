/**
 * 从模型回复中解析 JSON 字符串数组。
 * 兼容：纯 JSON、代码围栏、夹杂说明文字中的数组。
 * @param {string} content 模型原始 content
 * @returns {string[]}
 */
function parseTranslationArray(content) {
  const text = String(content == null ? "" : content).trim();
  if (!text) {
    throw new Error("AI 返回空结果");
  }

  /**
   * 尝试把值规范为字符串数组。
   * @param {unknown} value 解析结果
   * @returns {string[]|null}
   */
  function asStringArray(value) {
    if (!Array.isArray(value)) return null;
    return value.map(function (item) {
      if (item == null) return "";
      if (typeof item === "string") return item;
      if (typeof item === "number" || typeof item === "boolean") {
        return String(item);
      }
      // 偶发对象包装：{ text: "..." } / { translation: "..." }
      if (typeof item === "object") {
        if (typeof item.text === "string") return item.text;
        if (typeof item.translation === "string") return item.translation;
      }
      return String(item);
    });
  }

  // 直接解析
  try {
    const direct = asStringArray(JSON.parse(text));
    if (direct) return direct;
  } catch (_) {
    /* 继续尝试其它形态 */
  }

  // 代码围栏 ```json ... ```
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const fenced = asStringArray(JSON.parse(fenceMatch[1].trim()));
      if (fenced) return fenced;
    } catch (_) {
      /* 继续 */
    }
  }

  // 截取首尾方括号
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const sliced = asStringArray(JSON.parse(text.slice(start, end + 1)));
      if (sliced) return sliced;
    } catch (_) {
      /* 继续 */
    }
  }

  throw new Error("AI 返回无法解析为译文数组");
}

/**
 * 构造批量翻译用的 system / user 消息。
 * @param {string[]} texts 原文列表
 * @param {string} targetLang 目标语言
 * @param {{ strict?: boolean }} [opts] 选项；strict 时用更严提示（重试）
 * @returns {{ role: string, content: string }[]}
 */
function buildBatchMessages(texts, targetLang, opts) {
  const strict = opts && opts.strict;
  const system = strict
    ? [
        "你是翻译引擎。",
        "用户会给你一个 JSON 字符串数组（UTF-8）。",
        "请将数组中每一项翻译为 " + targetLang + "。",
        "必须只输出一个 JSON 数组，不要 markdown，不要解释，不要代码围栏。",
        "输出数组长度必须与输入完全一致，顺序一一对应。",
        "保留原文中的空白、换行与占位符号；不要合并或拆分条目。",
      ].join("")
    : [
        "你是翻译引擎。",
        "将用户给出的 JSON 字符串数组逐项翻译为 " + targetLang + "。",
        "只输出 JSON 字符串数组，长度与输入一致、顺序对应。",
        "不要解释，不要使用代码围栏。",
      ].join("");

  return [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(texts) },
  ];
}

/**
 * 创建 OpenAI 兼容 Chat Completions 翻译 Provider。
 * 将多段文本合并为一次对话（JSON 数组），大幅减少 API 请求次数。
 * @param {{ openaiBaseUrl: string, openaiApiKey: string, openaiModel: string }} settings 设置
 * @returns {{ id: string, name: string, maxChunkChars: number, maxChunkItems: number, translateTexts: Function }}
 */
function createOpenAICompatibleProvider(settings) {
  const base = settings.openaiBaseUrl.replace(/\/$/, "");
  const endpoint = base.endsWith("/chat/completions")
    ? base
    : base + "/chat/completions";

  /**
   * 发起一次 chat/completions 请求并解析为译文数组。
   * @param {string[]} texts 原文列表
   * @param {string} targetLang 目标语言
   * @param {boolean} strict 是否使用严格提示
   * @returns {Promise<string[]>}
   */
  async function requestBatch(texts, targetLang, strict) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.openaiApiKey,
      },
      body: JSON.stringify({
        model: settings.openaiModel,
        temperature: 0.2,
        messages: buildBatchMessages(texts, targetLang, { strict: strict }),
      }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("API Key 无效或无权访问");
    }
    if (!res.ok) {
      throw new Error("无法连接自定义 AI 端点或服务返回错误");
    }
    const data = await res.json();
    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    const translated = parseTranslationArray(content);
    if (translated.length !== texts.length) {
      throw new Error(
        "AI 返回条目数不一致（期望 " +
          texts.length +
          "，实际 " +
          translated.length +
          "）"
      );
    }
    return translated;
  }

  return {
    id: "openai",
    name: "自定义 AI",
    // 一次对话可承载更大块，减少分批次数
    maxChunkChars: 12000,
    maxChunkItems: 80,

    /**
     * 批量翻译文本：一段对话处理整个数组（单批）。
     * @param {string[]} texts 原文列表
     * @param {{ targetLang: string }} options 选项
     * @returns {Promise<string[]>}
     */
    async translateTexts(texts, options) {
      if (!texts.length) return [];
      const targetLang = (options && options.targetLang) || "zh-Hans";
      try {
        return await requestBatch(texts, targetLang, false);
      } catch (firstError) {
        // 鉴权类错误不重试
        const msg = (firstError && firstError.message) || "";
        if (msg.indexOf("API Key") >= 0 || msg.indexOf("无权") >= 0) {
          throw firstError;
        }
        if (msg.indexOf("无法连接") >= 0) {
          throw firstError;
        }
        // 格式/条数问题：严格提示重试一次
        try {
          return await requestBatch(texts, targetLang, true);
        } catch (secondError) {
          throw secondError;
        }
      }
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    createOpenAICompatibleProvider,
    parseTranslationArray,
    buildBatchMessages,
  };
}
