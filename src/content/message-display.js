/**
 * 获取可用于写入正文的 document。
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
 * 在阅读窗应用 HTML 正文。
 * @param {string} html 正文 HTML
 */
function applyBodyHtml(html) {
  const doc = getTargetDocument();
  if (doc && doc.body) {
    doc.body.innerHTML = html;
  }
}

/**
 * 在正文顶部显示主题译文横幅。
 * @param {string} subject 主题
 */
function applySubject(subject) {
  let banner = document.getElementById("tb-translate-subject-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "tb-translate-subject-banner";
    banner.style.cssText =
      "padding:8px 12px;background:#e8f0fe;border-bottom:1px solid #c5d4f0;font-weight:600;font-family:sans-serif;position:relative;z-index:9999;";
    if (document.body) {
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }
  if (banner) banner.textContent = "主题：" + subject;
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
      "padding:8px 12px;background:#fdecea;color:#b71c1c;border-bottom:1px solid #f5c6cb;font-family:sans-serif;position:relative;z-index:9999;";
    if (document.body) {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }
  if (bar) bar.textContent = message;
  setTimeout(function () {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
  }, 8000);
}

/**
 * 处理显示指令。
 * @param {object} msg 消息
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
  if (msg.type === "SHOW_ERROR") {
    showError(msg.message || "翻译失败");
  }
}

/**
 * 建立与后台的长连接，并监听指令。
 */
function connectBackground() {
  try {
    const port = browser.runtime.connect({ name: "tb-translate-display" });
    port.onMessage.addListener(handleDisplayMessage);
    port.onDisconnect.addListener(function () {
      // 邮件切换后可能断开，稍后重连
      setTimeout(connectBackground, 500);
    });
  } catch (e) {
    console.warn("connectBackground failed", e);
    setTimeout(connectBackground, 1000);
  }
}

// runtime 消息（备用）
if (typeof browser !== "undefined" && browser.runtime && browser.runtime.onMessage) {
  browser.runtime.onMessage.addListener(function (msg) {
    handleDisplayMessage(msg);
  });
}

// storage 桥接（备用）
if (typeof browser !== "undefined" && browser.storage && browser.storage.onChanged) {
  browser.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (!changes.__tbTranslateApply || !changes.__tbTranslateApply.newValue) return;
    const data = changes.__tbTranslateApply.newValue;
    if (data && data.payload) handleDisplayMessage(data.payload);
  });
}

// 启动
connectBackground();
try {
  browser.runtime.sendMessage({ type: "DISPLAY_READY" });
} catch (e) {
  // 忽略
}

console.log("tb-translate message-display script loaded");