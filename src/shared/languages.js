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
