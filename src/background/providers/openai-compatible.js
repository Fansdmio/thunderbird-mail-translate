/**
 * 创建 OpenAI 兼容 Chat Completions 翻译 Provider。
 * @param {{ openaiBaseUrl: string, openaiApiKey: string, openaiModel: string }} settings 设置
 * @returns {{ id: string, name: string, translateTexts: Function }}
 */
function createOpenAICompatibleProvider(settings) {
  const base = settings.openaiBaseUrl.replace(/\/$/, "");
  const endpoint = base.endsWith("/chat/completions")
    ? base
    : base + "/chat/completions";

  return {
    id: "openai",
    name: "自定义 AI",

    /**
     * 逐段翻译文本（保证顺序与控制提示词）。
     * @param {string[]} texts 原文列表
     * @param {{ targetLang: string }} options 选项
     * @returns {Promise<string[]>}
     */
    async translateTexts(texts, options) {
      const targetLang = (options && options.targetLang) || "zh-Hans";
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
        if (!res.ok) {
          throw new Error("无法连接自定义 AI 端点或服务返回错误");
        }
        const data = await res.json();
        const content =
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content;
        if (!content) {
          throw new Error("AI 返回空结果");
        }
        results.push(String(content).trim());
      }
      return results;
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { createOpenAICompatibleProvider };
}
