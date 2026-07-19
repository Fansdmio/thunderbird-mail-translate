/** 翻译缓存：tabId:messageId -> { original, translated, view } */
const cache = new Map();
/** 阅读窗 Port：tabId -> Port */
const displayPorts = new Map();
/** 当前邮件：tabId -> messageId */
const currentMessageByTab = new Map();

const PORT_NAME = "tb-translate-display";

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
 * 解析 tabId（兼容 number / Tab）。
 * @param {number|object} tabOrId 参数
 * @returns {number|null}
 */
function resolveTabId(tabOrId) {
  if (tabOrId == null) return null;
  if (typeof tabOrId === "number") return tabOrId;
  if (typeof tabOrId === "object" && tabOrId.id != null) return tabOrId.id;
  return null;
}

/**
 * 注册阅读窗脚本（需 messagesModify）。
 */
async function registerMessageDisplayScripts() {
  try {
    if (browser.messageDisplayScripts && browser.messageDisplayScripts.register) {
      await browser.messageDisplayScripts.register({
        js: [{ file: "src/content/message-display.js" }],
      });
    }
  } catch (e) {
    // manifest 已声明时重复注册可能失败，忽略
  }
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
      (browser.i18n && browser.i18n.getMessage("actionShowTranslated")) || "显示译文",
  };
  try {
    await browser.messageDisplayAction.setTitle({
      tabId: tabId,
      title: titles[state] || titles.idle,
    });
  } catch (e) {
    // 部分版本不支持 setTitle
  }
}

/**
 * 按当前邮件同步按钮（切换邮件后 DOM 为原文）。
 * @param {number} tabId 标签 ID
 * @param {number|string|null} messageId 邮件 ID
 */
async function syncActionForDisplayedMessage(tabId, messageId) {
  if (tabId == null) return;
  if (messageId == null) {
    currentMessageByTab.delete(tabId);
    await setActionState(tabId, "idle");
    return;
  }
  currentMessageByTab.set(tabId, messageId);
  const entry = cache.get(cacheKey(tabId, messageId));
  if (entry && entry.translated) {
    entry.view = "original";
    await setActionState(tabId, "original");
    return;
  }
  await setActionState(tabId, "idle");
}

/**
 * 清理标签相关状态。
 * @param {number} tabId 标签 ID
 */
function clearTabState(tabId) {
  if (tabId == null) return;
  currentMessageByTab.delete(tabId);
  displayPorts.delete(tabId);
  const prefix = tabId + ":";
  for (const key of Array.from(cache.keys())) {
    if (String(key).indexOf(prefix) === 0) cache.delete(key);
  }
}

/**
 * 从 MIME 结构提取 HTML/纯文本正文。
 * @param {any} full getFull 结果
 * @returns {string}
 */
function extractBodyHtml(full) {
  /**
   * @param {any} part MIME 部件
   * @returns {{ html: string|null, text: string|null }}
   */
  function walk(part) {
    if (!part) return { html: null, text: null };
    let html = null;
    let text = null;
    const ct = (part.contentType || "").toLowerCase();
    if (ct.startsWith("text/html") && part.body) html = part.body;
    if (ct.startsWith("text/plain") && part.body) text = part.body;
    if (part.parts) {
      for (const p of part.parts) {
        const r = walk(p);
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
    '<pre style="white-space:pre-wrap;font-family:inherit">' + escaped + "</pre>"
  );
}

/**
 * 读取当前标签展示的邮件内容。
 * @param {number} tabId 标签 ID
 * @returns {Promise<{ messageId: any, subject: string, html: string }>}
 */
async function getDisplayedMessageContent(tabId) {
  const message = await browser.messageDisplay.getDisplayedMessage(tabId);
  if (!message) throw new Error("当前没有打开的邮件");
  const full = await browser.messages.getFull(message.id);
  return {
    messageId: message.id,
    subject: message.subject || "",
    html: extractBodyHtml(full),
  };
}

/**
 * 向阅读窗发送显示指令（Port 优先）。
 * @param {number} tabId 标签 ID
 * @param {object} payload 指令
 */
async function sendToDisplay(tabId, payload) {
  const port = displayPorts.get(tabId);
  if (port) {
    port.postMessage(payload);
    return;
  }

  if (displayPorts.size > 0) {
    let ok = false;
    displayPorts.forEach(function (p) {
      try {
        p.postMessage(payload);
        ok = true;
      } catch (e) {
        // 忽略坏端口
      }
    });
    if (ok) return;
  }

  try {
    await browser.tabs.sendMessage(tabId, payload);
    return;
  } catch (e) {
    // 继续 storage 桥接
  }

  await browser.storage.local.set({
    __tbTranslateApply: { ts: Date.now(), tabId: tabId, payload: payload },
  });
  if (displayPorts.size === 0) {
    throw new Error("阅读窗脚本未就绪，请关闭邮件后重新打开再试");
  }
}

/**
 * 处理翻译按钮点击。
 * @param {object} tab 标签
 */
async function onTranslateClicked(tab) {
  const tabId = tab.id;
  try {
    const content = await getDisplayedMessageContent(tabId);
    currentMessageByTab.set(tabId, content.messageId);
    const key = cacheKey(tabId, content.messageId);
    const entry = cache.get(key);

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
      console.error("翻译失败：", e);
    }
  }
}

// --- 事件绑定 ---

browser.runtime.onConnect.addListener(function (port) {
  if (!port || port.name !== PORT_NAME) return;
  const tabId = resolveTabId(port.sender && port.sender.tab);
  const key = tabId != null ? tabId : "unknown-" + Date.now();
  displayPorts.set(key, port);
  port.onDisconnect.addListener(function () {
    displayPorts.delete(key);
  });
});

browser.messageDisplayAction.onClicked.addListener(onTranslateClicked);

if (browser.messageDisplay && browser.messageDisplay.onMessageDisplayed) {
  browser.messageDisplay.onMessageDisplayed.addListener(async function (tab, message) {
    const tabId = resolveTabId(tab);
    const messageId = message && message.id != null ? message.id : null;
    try {
      await syncActionForDisplayedMessage(tabId, messageId);
    } catch (e) {
      console.warn("同步按钮状态失败", e);
    }
  });
}

if (browser.tabs && browser.tabs.onRemoved) {
  browser.tabs.onRemoved.addListener(function (tabId) {
    clearTabState(tabId);
  });
}

browser.runtime.onMessage.addListener(function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "GET_SETTINGS") return loadSettings();
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

registerMessageDisplayScripts();
