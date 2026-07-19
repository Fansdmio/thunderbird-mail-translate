/**
 * 创建 Azure 官方 Translator Provider。
 * @param {{ azureKey: string, azureRegion: string }} settings 设置
 * @returns {{ id: string, name: string, translateTexts: Function }}
 */
function createMicrosoftAzureProvider(settings) {
  return {
    id: "microsoft-azure",
    name: "微软 Azure",

    /**
     * 批量翻译文本。
     * @param {string[]} texts 原文列表
     * @param {{ targetLang: string }} options 选项
     * @returns {Promise<string[]>}
     */
    async translateTexts(texts, options) {
      const targetLang = (options && options.targetLang) || "zh-Hans";
      const url =
        "https://api.cognitive.microsofttranslator.com/translate?" +
        new URLSearchParams({
          "api-version": "3.0",
          to: targetLang,
        }).toString();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": settings.azureKey,
          "Ocp-Apim-Subscription-Region": settings.azureRegion,
        },
        body: JSON.stringify(texts.map((Text) => ({ Text: Text }))),
      });
      if (!res.ok) {
        throw new Error("Azure 密钥或区域无效，或服务暂时不可用");
      }
      const data = await res.json();
      return data.map((item) => item.translations[0].text);
    },
  };
}

if (typeof module !== "undefined") {
  module.exports = { createMicrosoftAzureProvider };
}
