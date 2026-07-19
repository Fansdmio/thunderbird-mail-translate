/** 翻译结果缓存：key = tabId:messageId */
const cache = new Map();

/** 阅读窗 content script 端口：tabId -> Port */
const displayPorts = new Map();

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
 * 启动时注册阅读窗脚本（需要 messagesModify）。
 * manifest 里也有声明，这里再 register 一次提高兼容性。
 */
async function registerMessageDisplayScripts() {
  try {
    if (browser.messageDisplayScripts && browser.messageDisplayScripts.register) {
      await browser.messageDisplayScripts.register({
        js: [{ file: "src/content/message-display.js" }],
      });
      console.log("messageDisplayScripts.register 成功");
    }
  } catch (e) {
    // 若 manifest 已注入，重复注册可能报错，忽略
    console.warn("messageDisplayScripts.register:", (e && e.message) || e);
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
 * 向阅读窗应用显示指令。
 * 优先 Port，其次 tabs.sendMessage，最后 storage 桥接。
 * @param {number} tabId 标签 ID
 * @param {object} payload 消息
 */
async function sendToDisplay(tabId, payload) {
  const errors = [];

  // 1) 长连接 Port（content 启动时 connect）
  const port = displayPorts.get(tabId);
  if (port) {
    try {
      port.postMessage(payload);
      return;
    } catch (e) {
      errors.push("port: " + ((e && e.message) || e));
      displayPorts.delete(tabId);
    }
  }

  // 2) 广播给所有阅读窗端口（tabId 可能不一致时的兜底）
  if (displayPorts.size > 0) {
    let any = false;
    displayPorts.forEach(function (p, id) {
      try {
        p.postMessage(Object.assign({ _targetTabId: tabId }, payload));
        any = true;
      } catch (e) {
        errors.push("port#" + id + ": " + ((e && e.message) || e));
        displayPorts.delete(id);
      }
    });
    if (any) return;
  }

  // 3) tabs.sendMessage（脚本已注入时可用）
  try {
    await browser.tabs.sendMessage(tabId, payload);
    return;
  } catch (e) {
    errors.push("sendMessage: " + ((e && e.message) || e));
  }

  // 4) storage 桥接：content 监听 storage.onChanged
  try {
    await browser.storage.local.set({
      __tbTranslateApply: {
        ts: Date.now(),
        tabId: tabId,
        payload: payload,
      },
    });
    // 给 content 一点时间处理
    await new Promise(function (r) {
      setTimeout(r, 50);
    });
    // 若仍无端口，说明阅读窗脚本未注入
    if (displayPorts.size === 0) {
      throw new Error(
        "阅读窗脚本未注入。请确认已授权 messagesModify，并关闭邮件后重新打开。"
      );
    }
    return;
  } catch (e) {
    errors.push("storage: " + ((e && e.message) || e));
  }

  console.error("sendToDisplay 全部失败", errors);
  throw new Error(
    "无法写入阅读窗显示。请关闭邮件后重新打开再试。详情：" + errors.join(" | ")
  );
}

// 阅读窗 content 建立长连接
browser.runtime.onConnect.addListener(function (port) {
  if (!port || port.name !== "tb-translate-display") return;
  const tabId =
    port.sender && port.sender.tab && port.sender.tab.id != null
      ? port.sender.tab.id
      : null;

  if (tabId != null) {
    displayPorts.set(tabId, port);
    console.log("阅读窗已连接 tabId=", tabId);
  } else {
    // 无 tab 信息时用临时键，广播时仍可用
    const fallbackKey = "unknown-" + Date.now();
    displayPorts.set(fallbackKey, port);
    console.log("阅读窗已连接（无 tabId）", fallbackKey);
  }

  port.onDisconnect.addListener(function () {
    if (tabId != null) {
      displayPorts.delete(tabId);
    } else {
      // 清理 unknown 端口
      displayPorts.forEach(function (p, k) {
        if (p === port) displayPorts.delete(k);
      });
    }
  });
});

// 工具栏点击：翻译 / 切换原文译文
browser.messageDisplayAction.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  try {
    const content = await getDisplayedMessageContent(tabId);
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
  // content 就绪心跳
  if (msg.type === "DISPLAY_READY") {
    console.log("DISPLAY_READY from tab", msg.tabId);
    return Promise.resolve({ ok: true });
  }
});

// 启动注册
registerMessageDisplayScripts();