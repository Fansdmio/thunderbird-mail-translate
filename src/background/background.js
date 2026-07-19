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
    // 部分版本可能不支持 setTitle，忽略
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
 * 向阅读窗发送消息（兼容失败）。
 * @param {number} tabId 标签 ID
 * @param {object} payload 消息
 */
async function sendToDisplay(tabId, payload) {
  try {
    await browser.tabs.sendMessage(tabId, payload);
  } catch (e) {
    // 某些 Thunderbird 版本阅读窗 tab 通信方式不同
    console.warn("sendMessage failed, try runtime broadcast", e);
    try {
      await browser.runtime.sendMessage(
        Object.assign({ _tabId: tabId }, payload)
      );
    } catch (e2) {
      console.error("broadcast failed", e2);
      throw e;
    }
  }
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
      // 忽略
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
