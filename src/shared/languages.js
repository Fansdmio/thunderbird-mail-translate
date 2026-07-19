/**
 * 返回首版支持的目标语言列表。
 * @returns {{ code: string, label: string }[]}
 */
function getTargetLanguages() {
  return [
    { code: "zh-Hans", label: "简体中文 / Chinese (Simplified)" },
    { code: "zh-Hant", label: "繁体中文 / Chinese (Traditional)" },
    { code: "en", label: "英语 / English" },
    { code: "ja", label: "日语 / Japanese" },
    { code: "ko", label: "韩语 / Korean" },
    { code: "fr", label: "法语 / French" },
    { code: "de", label: "德语 / German" },
    { code: "es", label: "西班牙语 / Spanish" },
    { code: "ru", label: "俄语 / Russian" },
  ];
}

if (typeof module !== "undefined") {
  module.exports = { getTargetLanguages };
}