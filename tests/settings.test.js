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
    assert.equal(r.code, "errorOpenaiBaseUrlRequired");
  });

  it("openai 非法 URL 失败", () => {
    const r = validateSettingsForEngine({
      ...DEFAULT_SETTINGS,
      engine: "openai",
      openaiBaseUrl: "notaurl",
      openaiApiKey: "k",
      openaiModel: "m",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "errorInvalidBaseUrl");
  });

  it("normalizeSettings 填充默认目标语言", () => {
    const s = normalizeSettings({});
    assert.equal(s.targetLang, "zh-Hans");
  });
});