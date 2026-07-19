/**
 * 获取可用于写入正文的 document。
 * @returns {Document}
 */
function getTargetDocument() {
  // 阅读窗可能是 iframe
  const iframe = document.querySelector("iframe");
  if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
    return iframe.contentDocument;
  }
  return document;
}

/**
 * 在阅读窗应用 HTML 正文。
 * @param {string} html 正文 HTML
 */
function applyBodyHtml(html) {
  const doc = getTargetDocument();
  if (doc.body) {
    doc.body.innerHTML = html;
  }
}

/**
 * 尝试更新可见主题显示。
 * @param {string} subject 主题
 */
function applySubject(subject) {
  const doc = getTargetDocument();
  const el =
    document.querySelector(".subject") ||
    document.getElementById("expandedsubjectBox") ||
    doc.querySelector(".subject");
  if (el) {
    el.textContent = subject;
  }
  // 回退：正文顶部横幅
  let banner = document.getElementById("tb-translate-subject-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "tb-translate-subject-banner";
    banner.style.cssText =
      "padding:8px 12px;background:#e8f0fe;border-bottom:1px solid #c5d4f0;font-weight:600;font-family:sans-serif;";
    const host = document.body || (doc && doc.body);
    if (host) {
      host.insertBefore(banner, host.firstChild);
    }
  }
  banner.textContent = "主题：" + subject;
}

/**
 * 显示错误提示条。
 * @param {string} message 错误信息
 */
function showError(message) {
  let bar = document.getElementById("tb-translate-error");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "tb-translate-error";
    bar.style.cssText =
      "padding:8px 12px;background:#fdecea;color:#b71c1c;border-bottom:1px solid #f5c6cb;font-family:sans-serif;";
    if (document.body) {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }
  bar.textContent = message;
  setTimeout(function () {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }, 8000);
}

/**
 * 处理来自后台的显示指令。
 * @param {object} msg 消息
 */
function handleDisplayMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "APPLY_TRANSLATION" || msg.type === "APPLY_ORIGINAL") {
    if (msg.html != null) applyBodyHtml(msg.html);
    if (msg.subject != null) applySubject(msg.subject);
    const err = document.getElementById("tb-translate-error");
    if (err && err.parentNode) err.parentNode.removeChild(err);
  }
  if (msg.type === "SHOW_ERROR") {
    showError(msg.message || "翻译失败");
  }
}

browser.runtime.onMessage.addListener(handleDisplayMessage);
