/**
 * 读取 i18n 文案。
 * @param {string} key 消息键
 * @param {string|string[]} [subs] 占位替换
 * @returns {string}
 */
function t(key, subs) {
  try {
    if (browser.i18n && browser.i18n.getMessage) {
      const msg = browser.i18n.getMessage(key, subs);
      if (msg) return msg;
    }
  } catch (e) {
    // 忽略
  }
  return key;
}

/**
 * 应用 data-i18n / data-i18n-placeholder 到页面。
 */
function applyI18n() {
  document.title = t("optionsTitle");
  const nodes = document.querySelectorAll("[data-i18n]");
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const key = el.getAttribute("data-i18n");
    if (!key) continue;
    const text = t(key);
    if (el.tagName === "OPTION") {
      el.textContent = text;
    } else if (el.tagName === "TITLE") {
      el.textContent = text;
    } else {
      el.textContent = text;
    }
  }
  const ph = document.querySelectorAll("[data-i18n-placeholder]");
  for (let j = 0; j < ph.length; j++) {
    const el2 = ph[j];
    const key2 = el2.getAttribute("data-i18n-placeholder");
    if (key2) el2.setAttribute("placeholder", t(key2));
  }
}

/**
 * 根据引擎显示对应配置区。
 */
function updateSections() {
  const engine = document.getElementById("engine").value;
  document.getElementById("azureSection").hidden = engine !== "microsoft-azure";
  document.getElementById("openaiSection").hidden = engine !== "openai";
}

/**
 * 从页面表单读取设置。
 * @returns {object}
 */
function readFormSettings() {
  return {
    engine: document.getElementById("engine").value,
    targetLang: document.getElementById("targetLang").value,
    azureKey: document.getElementById("azureKey").value,
    azureRegion: document.getElementById("azureRegion").value,
    openaiBaseUrl: document.getElementById("openaiBaseUrl").value,
    openaiApiKey: document.getElementById("openaiApiKey").value,
    openaiModel: document.getElementById("openaiModel").value,
  };
}

/**
 * 将设置写入表单。
 * @param {object} s 设置
 */
function fillForm(s) {
  document.getElementById("engine").value = s.engine || "microsoft-free";
  document.getElementById("targetLang").value = s.targetLang || "zh-Hans";
  document.getElementById("azureKey").value = s.azureKey || "";
  document.getElementById("azureRegion").value = s.azureRegion || "";
  document.getElementById("openaiBaseUrl").value = s.openaiBaseUrl || "";
  document.getElementById("openaiApiKey").value = s.openaiApiKey || "";
  document.getElementById("openaiModel").value = s.openaiModel || "";
  updateSections();
}

/**
 * 设置状态文案。
 * @param {string} text 文案
 * @param {boolean} isError 是否错误
 */
function setStatus(text, isError) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.style.color = isError ? "#b71c1c" : "#0d652d";
}

/**
 * 将校验错误转为可读文案。
 * @param {{ ok: boolean, code?: string, error?: string }} check 校验结果
 * @returns {string}
 */
function formatValidationError(check) {
  if (check && check.code) {
    const msg = t(check.code);
    if (msg && msg !== check.code) return msg;
  }
  return (check && check.error) || t("statusSaveFailed");
}

/**
 * 保存/测试前为自定义 AI 申请主机权限。
 * @param {object} settings 设置
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function ensureOpenAIPermission(settings) {
  if (settings.engine !== "openai") return { ok: true };
  const result = await requestHostPermission(settings.openaiBaseUrl);
  if (result.ok) return { ok: true };
  const code = result.errorCode || "statusPermissionDenied";
  return { ok: false, error: t(code) };
}

/**
 * 初始化设置页。
 */
async function init() {
  applyI18n();

  // 填充语言列表
  const select = document.getElementById("targetLang");
  const langs = getTargetLanguages();
  for (let i = 0; i < langs.length; i++) {
    const opt = document.createElement("option");
    opt.value = langs[i].code;
    opt.textContent = langs[i].label + " (" + langs[i].code + ")";
    select.appendChild(opt);
  }

  // 加载已有设置
  try {
    const settings = await browser.runtime.sendMessage({ type: "GET_SETTINGS" });
    fillForm(settings || normalizeSettings({}));
  } catch (e) {
    fillForm(normalizeSettings({}));
  }

  document.getElementById("engine").addEventListener("change", updateSections);

  document.getElementById("save").addEventListener("click", async function () {
    const settings = readFormSettings();
    const check = validateSettingsForEngine(settings);
    if (!check.ok) {
      setStatus(formatValidationError(check), true);
      return;
    }
    const perm = await ensureOpenAIPermission(settings);
    if (!perm.ok) {
      setStatus(perm.error || t("statusPermissionDenied"), true);
      return;
    }
    try {
      await browser.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: settings,
      });
      setStatus(t("statusSaved"), false);
    } catch (e) {
      setStatus((e && e.message) || t("statusSaveFailed"), true);
    }
  });

  document.getElementById("test").addEventListener("click", async function () {
    const settings = readFormSettings();
    const check = validateSettingsForEngine(settings);
    if (!check.ok) {
      setStatus(formatValidationError(check), true);
      return;
    }
    const perm = await ensureOpenAIPermission(settings);
    if (!perm.ok) {
      setStatus(perm.error || t("statusPermissionDenied"), true);
      return;
    }
    setStatus(t("statusTesting"), false);
    try {
      const result = await browser.runtime.sendMessage({
        type: "TEST_ENGINE",
        settings: settings,
      });
      if (result && result.ok) {
        setStatus(t("statusTestOk", [result.sample || ""]), false);
      } else {
        setStatus((result && result.error) || t("statusTestFailed"), true);
      }
    } catch (e) {
      setStatus((e && e.message) || t("statusTestFailed"), true);
    }
  });
}

document.addEventListener("DOMContentLoaded", init);