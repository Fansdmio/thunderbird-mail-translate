/** 翻译结果缓存：key = tabId:messageId */
const cache = new Map();

/**
 * 生成缓存键。
 * @param {number} tabId 标签 ID
 * @param {number|string} messageId 邮件 ID
 * @returns {string}
 */
function cacheKey(tabId, messageId) {
  return tabId + ":" + messageId;
}

/**
 * 更新工具栏按钮标题。
 * @param {number} tabId 标签 ID
 * @param {"idle"|"loading"|"translated"|"original"} state 状态
 */
async function setActionState(tabId, state) {
  const titles = {
    idle: (browser.i18n && browser.i18n.getMessage("actionTranslate")) || "翻译",
    loading:
      (browser.i18n && browser.i18n.getMessage("actionTranslating")) || "翻译中…",
    translated:
      (browser.i18n && browser.i18n.getMessage("actionShowOriginal")) || "显示原文",
    original:
      (browser.i18n && browser.i18n.getMessage("actionShowTranslated")) ||
      "显示译文",
  };
  try {
    await browser.messageDisplayAction.setTitle({
      tabId: tabId,
      title: titles[state] || titles.idle,
    });
  } catch (e) {
    console.warn("setTitle failed", e);
  }
}

/**
 * 从 getFull 结果提取 HTML 或纯文本。
 * @param {any} full 完整邮件结构
 * @returns {string} HTML
 */
function extractBodyHtml(full) {
  /**
   * 递归遍历 MIME parts。
   * @param {any} part 部件
   * @returns {{ html: string|null, text: string|null }}
   */
  function walk(part) {
    if (!part) return { html: null, text: null };
    let html = null;
    let text = null;
    const ct = (part.contentType || "").toLowerCase();
    if (ct.startsWith("text/html") && part.body) html = part.body;
    if (ct.startsWith("text/plain") && part.body) text = part.body;
    if (part.parts && Array.isArray(part.parts)) {
      for (let i = 0; i < part.parts.length; i++) {
        const r = walk(part.parts[i]);
        html = html || r.html;
        text = text || r.text;
      }
    }
    return { html: html, text: text };
  }
  const got = walk(full);
  if (got.html) return got.html;
  const escaped = (got.text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return (
    '<pre style="white-space:pre-wrap;font-family:inherit">' +
    escaped +
    "</pre>"
  );
}

/**
 * 获取当前标签显示的邮件完整内容。
 * @param {number} tabId 标签 ID
 * @returns {Promise<{ messageId: any, subject: string, html: string }>}
 */
async function getDisplayedMessageContent(tabId) {
  const message = await browser.messageDisplay.getDisplayedMessage(tabId);
  if (!message) {
    throw new Error("当前没有打开的邮件");
  }
  const full = await browser.messages.getFull(message.id);
  return {
    messageId: message.id,
    subject: message.subject || "",
    html: extractBodyHtml(full),
  };
}

/**
 * 生成在阅读窗内执行的注入脚本（字符串）。
 * 不依赖 content script 的 onMessage 通道。
 * @param {object} payload 显示指令
 * @returns {string}
 */
function buildInjectCode(payload) {
  // 使用 JSON 安全嵌入
  const data = JSON.stringify(payload);
  return (
    "(function(){\n" +
    "  var msg = " +
    data +
    ";\n" +
    "  function getDoc(){\n" +
    "    try {\n" +
    "      var iframe = document.querySelector('iframe');\n" +
    "      if (iframe && iframe.contentDocument && iframe.contentDocument.body) {\n" +
    "        return iframe.contentDocument;\n" +
    "      }\n" +
    "    } catch (e) {}\n" +
    "    return document;\n" +
    "  }\n" +
    "  function applyBody(html){\n" +
    "    var doc = getDoc();\n" +
    "    if (doc && doc.body) doc.body.innerHTML = html;\n" +
    "  }\n" +
    "  function applySubject(subject){\n" +
    "    var banner = document.getElementById('tb-translate-subject-banner');\n" +
    "    if (!banner) {\n" +
    "      banner = document.createElement('div');\n" +
    "      banner.id = 'tb-translate-subject-banner';\n" +
    "      banner.style.cssText = 'padding:8px 12px;background:#e8f0fe;border-bottom:1px solid #c5d4f0;font-weight:600;font-family:sans-serif;position:relative;z-index:9999;';\n" +
    "      var host = document.body;\n" +
    "      if (host) host.insertBefore(banner, host.firstChild);\n" +
    "    }\n" +
    "    if (banner) banner.textContent = '主题：' + subject;\n" +
    "  }\n" +
    "  function showError(message){\n" +
    "    var bar = document.getElementById('tb-translate-error');\n" +
    "    if (!bar) {\n" +
    "      bar = document.createElement('div');\n" +
    "      bar.id = 'tb-translate-error';\n" +
    "      bar.style.cssText = 'padding:8px 12px;background:#fdecea;color:#b71c1c;border-bottom:1px solid #f5c6cb;font-family:sans-serif;position:relative;z-index:9999;';\n" +
    "      if (document.body) document.body.insertBefore(bar, document.body.firstChild);\n" +
    "    }\n" +
    "    if (bar) bar.textContent = message;\n" +
    "    setTimeout(function(){ if (bar && bar.parentNode) bar.parentNode.removeChild(bar); }, 8000);\n" +
    "  }\n" +
    "  if (!msg || !msg.type) return;\n" +
    "  if (msg.type === 'APPLY_TRANSLATION' || msg.type === 'APPLY_ORIGINAL') {\n" +
    "    if (msg.html != null) applyBody(msg.html);\n" +
    "    if (msg.subject != null) applySubject(msg.subject);\n" +
    "    var err = document.getElementById('tb-translate-error');\n" +
    "    if (err && err.parentNode) err.parentNode.removeChild(err);\n" +
    "  }\n" +
    "  if (msg.type === 'SHOW_ERROR') showError(msg.message || '翻译失败');\n" +
    "})();"
  );
}

/**
 * 向阅读窗应用显示指令。
 * 优先 executeScript 直注 DOM；再尝试 sendMessage；最后 storage 桥接。
 * @param {number} tabId 标签 ID
 * @param {object} payload 消息
 */
async function sendToDisplay(tabId, payload) {
  const errors = [];

  // 1) 直接注入执行（不依赖 content script 是否已加载）
  try {
    if (browser.tabs && browser.tabs.executeScript) {
      await browser.tabs.executeScript(tabId, {
        code: buildInjectCode(payload),
      });
      return;
    }
  } catch (e) {
    errors.push("executeScript: " + ((e && e.message) || e));
  }

  // 2) 尝试先注入常驻 content 脚本，再 sendMessage
  try {
    if (browser.tabs && browser.tabs.executeScript) {
      await browser.tabs.executeScript(tabId, {
        file: "src/content/message-display.js",
      });
    }
  } catch (e) {
    errors.push("inject file: " + ((e && e.message) || e));
  }

  try {
    await browser.tabs.sendMessage(tabId, payload);
    return;
  } catch (e) {
    errors.push("sendMessage: " + ((e && e.message) || e));
  }

  // 3) storage 桥接：content script / 后续注入脚本可监听
  try {
    await browser.storage.local.set({
      __tbTranslateApply: {
        ts: Date.now(),
        tabId: tabId,
        payload: payload,
      },
    });
    // 再尝试 executeScript 读取 storage 并应用（双保险）
    try {
      await browser.tabs.executeScript(tabId, {
        code: buildInjectCode(payload),
      });
      return;
    } catch (e2) {
      errors.push("executeScript after storage: " + ((e2 && e2.message) || e2));
    }
  } catch (e) {
    errors.push("storage: " + ((e && e.message) || e));
  }

  console.error("sendToDisplay 全部失败", errors);
  throw new Error(
    "无法写入阅读窗显示。请关闭邮件后重新打开再试。详情：" + errors.join(" | ")
  );
}

// 工具栏点击：翻译 / 切换原文译文
browser.messageDisplayAction.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  try {
    const content = await getDisplayedMessageContent(tabId);
    const key = cacheKey(tabId, content.messageId);
    const entry = cache.get(key);

    // 已显示译文 → 切回原文
    if (entry && entry.view === "translated") {
      await sendToDisplay(tabId, {
        type: "APPLY_ORIGINAL",
        subject: entry.original.subject,
        html: entry.original.html,
      });
      entry.view = "original";
      await setActionState(tabId, "original");
      return;
    }

    // 已显示原文且有缓存译文 → 再显示译文
    if (entry && entry.view === "original" && entry.translated) {
      await sendToDisplay(tabId, {
        type: "APPLY_TRANSLATION",
        subject: entry.translated.subject,
        html: entry.translated.html,
      });
      entry.view = "translated";
      await setActionState(tabId, "translated");
      return;
    }

    // 首次翻译
    await setActionState(tabId, "loading");
    const settings = await loadSettings();
    const provider = createProvider(settings);
    const translated = await translateMessageContent(provider, content, {
      targetLang: settings.targetLang,
    });
    cache.set(key, {
      messageId: content.messageId,
      original: { subject: content.subject, html: content.html },
      translated: translated,
      view: "translated",
    });
    await sendToDisplay(tabId, {
      type: "APPLY_TRANSLATION",
      subject: translated.subject,
      html: translated.html,
    });
    await setActionState(tabId, "translated");
  } catch (e) {
    console.error(e);
    await setActionState(tabId, "idle");
    try {
      await sendToDisplay(tabId, {
        type: "SHOW_ERROR",
        message: (e && e.message) || "翻译失败",
      });
    } catch (_) {
      // 阅读窗写不进去时，至少把错误打到控制台
      console.error("翻译失败且无法在阅读窗提示：", e);
    }
  }
});

// 设置页消息
browser.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;
  if (msg.type === "GET_SETTINGS") {
    return loadSettings();
  }
  if (msg.type === "SAVE_SETTINGS") {
    return saveSettings(msg.settings).then(function () {
      return { ok: true };
    });
  }
  if (msg.type === "TEST_ENGINE") {
    return (async function () {
      try {
        const settings = normalizeSettings(msg.settings);
        const provider = createProvider(settings);
        const out = await provider.translateTexts(["Hello"], {
          targetLang: settings.targetLang,
        });
        return { ok: true, sample: out[0] };
      } catch (e) {
        return { ok: false, error: (e && e.message) || "测试失败" };
      }
    })();
  }
});