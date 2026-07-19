/**
 * 获取微软免费翻译临时访问令牌。
 * @returns {Promise<string>} 访问令牌
 */
async function fetchMicrosoftToken() {
  const res = await fetch("https://edge.microsoft.com/translate/auth");
  if (!res.ok) {
    throw new Error("无法获取微软翻译令牌，请检查网络或改用其他引擎");
  }
  return await res.text();
}

/**
 * 微软免 Key 翻译 Provider（Edge/Bing 同类接口）。
 * 注意：非官方接口，可能变更。
 */
const MicrosoftFreeProvider = {
  id: "microsoft-free",
  name: "微软翻译",

  /**
   * 批量翻译文本。
   * @param {string[]} texts 原文列表
   * @param {{ targetLang: string }} options 选项
   * @returns {Promise<string[]>} 译文列表
   */
  async translateTexts(texts, options) {
    const targetLang = (options && options.targetLang) || "zh-Hans";
    const token = await fetchMicrosoftToken();
    const url =
      "https://api-edge.cognitive.microsofttranslator.com/translate?" +
      new URLSearchParams({
        "api-version": "3.0",
        to: targetLang,
        includeSentenceLength: "true",
      }).toString();
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(texts.map((Text) => ({ Text: Text }))),
    });
    if (!res.ok) {
      throw new Error(
        "微软免费接口暂时不可用，请改用自定义 AI 或 Azure（HTTP " +
          res.status +
          ")"
      );
    }
    const data = await res.json();
    return data.map((item) => item.translations[0].text);
  },
};

if (typeof module !== "undefined") {
  module.exports = { MicrosoftFreeProvider, fetchMicrosoftToken };
}
