/**
 * 解析 HTML 为 document。
 * 扩展环境使用 DOMParser，Node 测试使用 linkedom。
 * @param {string} html HTML 字符串
 * @returns {Document}
 */
function parseDocument(html) {
  if (typeof DOMParser !== "undefined") {
    return new DOMParser().parseFromString(html || "", "text/html");
  }
  // Node 测试环境：片段需包一层 body，否则 linkedom 不挂到 body
  const { parseHTML } = require("linkedom");
  const wrapped =
    "<!DOCTYPE html><html><body>" + (html || "") + "</body></html>";
  return parseHTML(wrapped).document;
}

/** 不参与翻译的标签 */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

/**
 * 从 HTML 抽取可翻译文本片段，并用占位符替换。
 * @param {string} html 原始 HTML
 * @returns {{ segments: string[], skeleton: string }}
 */
function extractTextSegments(html) {
  const doc = parseDocument(html || "");
  const segments = [];
  const nodes = [];

  /**
   * 递归收集文本节点。
   * @param {Node} root 根节点
   */
  function walk(root) {
    if (!root) return;
    // 文本节点
    if (root.nodeType === 3) {
      const parent = root.parentElement || root.parentNode;
      if (parent && parent.tagName && SKIP_TAGS.has(parent.tagName)) return;
      const text = root.nodeValue;
      if (text == null || !String(text).trim()) return;
      nodes.push(root);
      segments.push(text);
      return;
    }
    // 元素节点：跳过不可译标签
    if (root.nodeType === 1 && root.tagName && SKIP_TAGS.has(root.tagName)) {
      return;
    }
    const children = root.childNodes ? Array.from(root.childNodes) : [];
    for (const child of children) {
      walk(child);
    }
  }

  walk(doc.body || doc.documentElement);
  nodes.forEach((n, i) => {
    n.nodeValue = "\uE000" + i + "\uE001";
  });
  const rootEl = doc.body || doc.documentElement;
  const skeleton = rootEl ? rootEl.innerHTML : "";
  return { segments, skeleton };
}

/**
 * 将译文写回 skeleton。
 * @param {string} skeleton 带占位符的 HTML
 * @param {string[]} translations 译文列表
 * @returns {string} 替换后的 HTML
 */
function applyTextSegments(skeleton, translations) {
  let out = skeleton || "";
  for (let i = 0; i < translations.length; i++) {
    const token = "\uE000" + i + "\uE001";
    out = out.split(token).join(translations[i] != null ? translations[i] : "");
  }
  return out;
}

if (typeof module !== "undefined") {
  module.exports = { extractTextSegments, applyTextSegments };
}