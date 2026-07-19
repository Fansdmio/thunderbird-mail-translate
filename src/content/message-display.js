const PORT_NAME = "tb-translate-display";

/**
 * 获取可写正文的 document。
 * @returns {Document}
 */
function getTargetDocument() {
  try {
    const iframe = document.querySelector("iframe");
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      return iframe.contentDocument;
    }
  } catch (e) {
    // 忽略
  }
  return document;
}

/**
 * 替换正文 HTML。
 * @param {string} html 正文
 */
function applyBodyHtml(html) {
  const doc = getTargetDocument();
  if (doc && doc.body) doc.body.innerHTML = html;
}

/**
 * 显示主题横幅。
 * @param {string} subject 主题
 */
function applySubject(subject) {
  let banner = document.getElementById("tb-translate-subject-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "tb-translate-subject-banner";
    banner.style.cssText =
      "padding:8px 12px;background:#e8f0fe;border-bottom:1px solid #c5d4f0;" +
      "font-weight:600;font-family:sans-serif;position:relative;z-index:9999;";
    if (document.body) document.body.insertBefore(banner, document.body.firstChild);
  }
  if (banner) banner.textContent = "主题：" + subject;
}

/**
 * 显示错误条。
 * @param {string} message 文案
 */
function showError(message) {
  let bar = document.getElementById("tb-translate-error");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "tb-translate-error";
    bar.style.cssText =
      "padding:8px 12px;background:#fdecea;color:#b71c1c;" +
      "border-bottom:1px solid #f5c6cb;font-family:sans-serif;position:relative;z-index:9999;";
    if (document.body) document.body.insertBefore(bar, document.body.firstChild);
  }
  if (bar) bar.textContent = message;
  setTimeout(function () {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }, 8000);
}

/**
 * 处理后台显示指令。
 * @param {object} msg 指令
 */
function handleDisplayMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "APPLY_TRANSLATION" || msg.type === "APPLY_ORIGINAL") {
    if (msg.html != null) applyBodyHtml(msg.html);
    if (msg.subject != null) applySubject(msg.subject);
    const err = document.getElementById("tb-translate-error");
    if (err && err.parentNode) err.parentNode.removeChild(err);
    return;
  }
  if (msg.type === "SHOW_ERROR") showError(msg.message || "翻译失败");
}

/**
 * 连接后台 Port。
 */
function connectBackground() {
  try {
    const port = browser.runtime.connect({ name: PORT_NAME });
    port.onMessage.addListener(handleDisplayMessage);
    port.onDisconnect.addListener(function () {
      setTimeout(connectBackground, 500);
    });
  } catch (e) {
    setTimeout(connectBackground, 1000);
  }
}

browser.runtime.onMessage.addListener(handleDisplayMessage);

browser.storage.onChanged.addListener(function (changes, area) {
  if (area !== "local") return;
  const item = changes.__tbTranslateApply;
  if (item && item.newValue && item.newValue.payload) {
    handleDisplayMessage(item.newValue.payload);
  }
});

connectBackground();
