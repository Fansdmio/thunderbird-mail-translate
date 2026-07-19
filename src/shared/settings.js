/** 默认设置 */
const DEFAULT_SETTINGS = {
  engine: "microsoft-free",
  targetLang: "zh-Hans",
  azureKey: "",
  azureRegion: "",
  openaiBaseUrl: "",
  openaiApiKey: "",
  openaiModel: "",
};

/**
 * 将存储中的对象规范为完整设置。
 * @param {object} raw 原始设置
 * @returns {object} 完整设置
 */
function normalizeSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    engine: src.engine || DEFAULT_SETTINGS.engine,
    targetLang: src.targetLang || DEFAULT_SETTINGS.targetLang,
    azureKey: src.azureKey || "",
    azureRegion: src.azureRegion || "",
    openaiBaseUrl: (src.openaiBaseUrl || "").replace(/\/$/, ""),
    openaiApiKey: src.openaiApiKey || "",
    openaiModel: src.openaiModel || "",
  };
}

/**
 * 校验当前引擎所需配置是否齐全。
 * @param {object} settings 设置对象
 * @returns {{ ok: boolean, error?: string, code?: string }}
 */
function validateSettingsForEngine(settings) {
  const s = normalizeSettings(settings);
  if (s.engine === "microsoft-free") {
    return { ok: true };
  }
  if (s.engine === "microsoft-azure") {
    if (!s.azureKey.trim()) {
      return {
        ok: false,
        code: "errorAzureKeyRequired",
        error: "请填写 Azure 订阅密钥",
      };
    }
    if (!s.azureRegion.trim()) {
      return {
        ok: false,
        code: "errorAzureRegionRequired",
        error: "请填写 Azure 区域（如 eastasia）",
      };
    }
    return { ok: true };
  }
  if (s.engine === "openai") {
    if (!s.openaiBaseUrl.trim()) {
      return {
        ok: false,
        code: "errorOpenaiBaseUrlRequired",
        error: "请填写 AI 端点 Base URL",
      };
    }
    // 基础 URL 格式预检
    try {
      const u = new URL(s.openaiBaseUrl);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        return {
          ok: false,
          code: "errorInvalidBaseUrl",
          error: "Base URL 无效",
        };
      }
    } catch (e) {
      return {
        ok: false,
        code: "errorInvalidBaseUrl",
        error: "Base URL 无效",
      };
    }
    if (!s.openaiApiKey.trim()) {
      return {
        ok: false,
        code: "errorOpenaiApiKeyRequired",
        error: "请填写 API Key",
      };
    }
    if (!s.openaiModel.trim()) {
      return {
        ok: false,
        code: "errorOpenaiModelRequired",
        error: "请填写模型 ID",
      };
    }
    return { ok: true };
  }
  return {
    ok: false,
    code: "errorUnknownEngine",
    error: "未知翻译引擎",
  };
}

/**
 * 从 browser.storage.local 读取设置（扩展环境）。
 * @returns {Promise<object>}
 */
async function loadSettings() {
  const stored = await browser.storage.local.get("settings");
  return normalizeSettings(stored.settings);
}

/**
 * 保存设置到本地存储。
 * @param {object} settings 设置对象
 * @returns {Promise<void>}
 */
async function saveSettings(settings) {
  await browser.storage.local.set({
    settings: normalizeSettings(settings),
  });
}

if (typeof module !== "undefined") {
  module.exports = {
    DEFAULT_SETTINGS,
    normalizeSettings,
    validateSettingsForEngine,
    loadSettings,
    saveSettings,
  };
}