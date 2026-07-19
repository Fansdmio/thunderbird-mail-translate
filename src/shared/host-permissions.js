/**
 * 主机权限辅助：自定义 AI 仅按需申请目标源。
 */

/**
 * 从 Base URL 生成 host permission 匹配模式（origin/*）。
 * @param {string} baseUrl Base URL
 * @returns {string|null} 匹配模式，无效时返回 null
 */
function originPatternFromUrl(baseUrl) {
  try {
    const raw = String(baseUrl || "").trim();
    if (!raw) return null;
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname) return null;
    return u.origin + "/*";
  } catch (e) {
    return null;
  }
}

/**
 * 检查是否已授予某 origin 主机权限。
 * @param {string} baseUrl Base URL
 * @returns {Promise<{ ok: boolean, origin: string|null, errorCode?: string }>}
 */
async function hasHostPermission(baseUrl) {
  const origin = originPatternFromUrl(baseUrl);
  if (!origin) {
    return { ok: false, origin: null, errorCode: "errorInvalidBaseUrl" };
  }
  if (!browser.permissions || !browser.permissions.contains) {
    // 极旧环境无法检查，放行由网络层报错
    return { ok: true, origin: origin };
  }
  try {
    const granted = await browser.permissions.contains({ origins: [origin] });
    if (granted) return { ok: true, origin: origin };
    return { ok: false, origin: origin, errorCode: "errorHostPermissionMissing" };
  } catch (e) {
    return { ok: false, origin: origin, errorCode: "errorHostPermissionMissing" };
  }
}

/**
 * 请求访问 Base URL 对应主机（须在用户手势中调用）。
 * @param {string} baseUrl Base URL
 * @returns {Promise<{ ok: boolean, origin: string|null, errorCode?: string }>}
 */
async function requestHostPermission(baseUrl) {
  const origin = originPatternFromUrl(baseUrl);
  if (!origin) {
    return { ok: false, origin: null, errorCode: "errorInvalidBaseUrl" };
  }
  if (!browser.permissions || !browser.permissions.request) {
    return { ok: true, origin: origin };
  }
  try {
    const already = await browser.permissions.contains({ origins: [origin] });
    if (already) return { ok: true, origin: origin };
    const granted = await browser.permissions.request({ origins: [origin] });
    if (granted) return { ok: true, origin: origin };
    return { ok: false, origin: origin, errorCode: "statusPermissionDenied" };
  } catch (e) {
    return { ok: false, origin: origin, errorCode: "statusPermissionDenied" };
  }
}

/**
 * 使用 OpenAI 引擎前确保主机权限已具备（仅检查，不弹窗）。
 * @param {object} settings 设置
 * @returns {Promise<void>}
 */
async function assertOpenAIHostPermission(settings) {
  if (!settings || settings.engine !== "openai") return;
  const result = await hasHostPermission(settings.openaiBaseUrl);
  if (!result.ok) {
    const code = result.errorCode || "errorHostPermissionMissing";
    const msg =
      (browser.i18n && browser.i18n.getMessage(code)) ||
      "Missing host permission for AI endpoint";
    throw new Error(msg);
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    originPatternFromUrl,
    hasHostPermission,
    requestHostPermission,
    assertOpenAIHostPermission,
  };
}