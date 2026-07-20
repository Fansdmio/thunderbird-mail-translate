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
 * 将缓存中的译文重新写回阅读窗。
 * @param {number} tabId 标签 ID
 * @param {{ translated?: { subject: string, html: string }, view?: string }} entry 缓存项
 * @returns {Promise<boolean>} 是否成功应用
 */
async function restoreTranslatedView(tabId, entry) {
  if (tabId == null || !entry || !entry.translated || entry.view !== "translated") {
    return false;
  }
  const payload = {
    type: "APPLY_TRANSLATION",
    subject: entry.translated.subject,
    html: entry.translated.html,
  };
  // 阅读窗脚本可能尚未连接，短暂重试
  for (let i = 0; i < 10; i++) {
    try {
      await sendToDisplay(tabId, payload);
      return true;
    } catch (e) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 80 * (i + 1));
      });
    }
  }
  console.warn("恢复译文失败：阅读窗脚本未就绪");
  return false;
}

/**
 * 按当前邮件同步按钮，并在需要时恢复上次译文视图。
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
    // 保留会话内上次原文/译文偏好；切换邮件后 DOM 会回到原文，需按状态重绘
    if (entry.view === "translated") {
      await setActionState(tabId, "translated");
      await restoreTranslatedView(tabId, entry);
      return;
    }
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
  if (!message) throw new Error(
    (browser.i18n && browser.i18n.getMessage("errorNoMessage")) ||
      "No message is open"
  );
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
    // 自定义 AI：确认主机权限（设置页保存时申请）
    if (typeof assertOpenAIHostPermission === "function") {
      await assertOpenAIHostPermission(settings);
    }
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
        message: (e && e.message) || ((browser.i18n && browser.i18n.getMessage("errorTranslateFailed")) || "Translation failed"),
      });
    } catch (_) {
      console.error("翻译失败：", e);
    }
  }
}

// --- 事件绑定 ---

/**
 * 根据 tab 当前邮件尝试恢复译文视图。
 * @param {number|null} tabId 标签 ID
 */
function tryRestoreForTab(tabId) {
  if (tabId == null) return;
  const messageId = currentMessageByTab.get(tabId);
  if (messageId == null) return;
  const entry = cache.get(cacheKey(tabId, messageId));
  restoreTranslatedView(tabId, entry).catch(function (e) {
    console.warn("恢复译文失败", e);
  });
}

browser.runtime.onConnect.addListener(function (port) {
  if (!port || port.name !== PORT_NAME) return;
  const tabId = resolveTabId(port.sender && port.sender.tab);
  const key = tabId != null ? tabId : "unknown-" + Date.now();
  displayPorts.set(key, port);
  port.onDisconnect.addListener(function () {
    displayPorts.delete(key);
  });
  // 阅读窗脚本就绪 / 主动就绪通知后补恢复译文
  port.onMessage.addListener(function (msg) {
    if (msg && msg.type === "DISPLAY_READY") {
      tryRestoreForTab(tabId);
    }
  });
  tryRestoreForTab(tabId);
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
        if (typeof assertOpenAIHostPermission === "function") {
          await assertOpenAIHostPermission(settings);
        }
        const provider = createProvider(settings);
        const out = await provider.translateTexts(["Hello"], {
          targetLang: settings.targetLang,
        });
        return { ok: true, sample: out[0] };
      } catch (e) {
        return {
          ok: false,
          error:
            (e && e.message) ||
            ((browser.i18n && browser.i18n.getMessage("statusTestFailed")) ||
              "Test failed"),
        };
      }
    })();
  }
});


/**
 * 解析 CSS 颜色为 RGB。
 * @param {string} color 颜色字符串
 * @returns {{r:number,g:number,b:number}|null}
 */
function parseCssColor(color) {
  if (!color || typeof color !== "string") return null;
  const s = color.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const rgb = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
  if (rgb) {
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
    };
  }
  return null;
}

/**
 * 判断是否为暗色主题（根据工具栏/窗框亮度）。
 * @returns {Promise<boolean>}
 */
async function isDarkTheme() {
  try {
    if (!browser.theme || !browser.theme.getCurrent) return false;
    const theme = await browser.theme.getCurrent();
    const colors = theme && theme.colors;
    if (!colors) return false;
    const candidate =
      colors.toolbar || colors.frame || colors.sidebar || colors.popup;
    const rgb = parseCssColor(candidate);
    if (!rgb) return false;
    // 相对亮度
    const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    return lum < 0.45;
  } catch (e) {
    return false;
  }
}

/**
 * 按主题切换工具栏图标（补强 theme_icons）。
 */
async function applyToolbarIcons() {
  try {
    const dark = await isDarkTheme();
    // 暗色主题用蓝底白标；亮色主题用浅底深标
    const path = dark
      ? {
          16: "src/icons/icon-light-16.png",
          32: "src/icons/icon-light-32.png",
          48: "src/icons/icon-light-48.png",
          64: "src/icons/icon-light-64.png",
        }
      : {
          16: "src/icons/icon-16.png",
          32: "src/icons/icon-32.png",
          48: "src/icons/icon-48.png",
          64: "src/icons/icon-64.png",
        };
    await browser.messageDisplayAction.setIcon({ path: path });
  } catch (e) {
    console.warn("切换主题图标失败", e);
  }
}

registerMessageDisplayScripts();
applyToolbarIcons();
if (browser.theme && browser.theme.onUpdated) {
  browser.theme.onUpdated.addListener(function () {
    applyToolbarIcons();
  });
}


