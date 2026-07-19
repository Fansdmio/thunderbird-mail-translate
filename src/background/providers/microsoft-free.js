/**
 * 微软 Edge 免费翻译 Provider。
 * 策略参考 YiiGuxing/TranslationPlugin：
 * - JWT 令牌本地缓存（按 exp 刷新）
 * - 结果缓存减少重复请求
 * - 请求节流 + 429 指数退避
 * - 优先 api.cognitive，失败回退 api-edge
 * 注意：免费接口为共享配额，按 IP 限流；无法通过伪造客户端永久“硬绕过”。
 */

/** 鉴权地址 */
const AUTH_URL = "https://edge.microsoft.com/translate/auth";

/** 主翻译端点（IDEA 插件同款） */
const TRANSLATE_URL_PRIMARY =
  "https://api.cognitive.microsofttranslator.com/translate";

/** 备用翻译端点 */
const TRANSLATE_URL_EDGE =
  "https://api-edge.cognitive.microsofttranslator.com/translate";

/** 令牌提前刷新窗口（毫秒） */
const TOKEN_PRE_EXPIRE_MS = 2 * 60 * 1000;

/** 令牌解析失败时的默认有效期 */
const TOKEN_DEFAULT_TTL_MS = 10 * 60 * 1000;

/** 单次请求最大字符数（保守值，低于官方 5 万） */
const MAX_CHARS_PER_REQUEST = 4500;

/** 单次请求最大条目数（官方 1000，免费端更保守） */
const MAX_ITEMS_PER_REQUEST = 40;

/** 请求最小间隔（毫秒），降低触发突发限流概率 */
const MIN_REQUEST_INTERVAL_MS = 350;

/** 429 最大重试次数 */
const MAX_429_RETRIES = 4;

/** 结果缓存上限 */
const RESULT_CACHE_MAX = 500;

/** 内存中的访问令牌 */
let cachedToken = null;

/** 令牌过期时间戳 */
let tokenExpireAt = 0;

/** 进行中的令牌请求，避免并发重复拉取 */
let tokenInflight = null;

/** 上次实际发出翻译请求的时间 */
let lastRequestAt = 0;

/** 原文 -> 译文 结果缓存 */
const resultCache = new Map();

/**
 * 生成简易 UUID（用于 X-ClientTraceId）。
 * @returns {string}
 */
function createTraceId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 异步等待指定毫秒。
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * 从 JWT 解析过期时间（毫秒时间戳）。
 * @param {string} token JWT
 * @returns {number}
 */
function getTokenExpireAt(token) {
  try {
    const payloadPart = token.split(".")[1];
    // 兼容 URL-safe Base64
    const b64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("utf8");
    const payload = JSON.parse(json);
    if (payload && typeof payload.exp === "number") {
      return payload.exp * 1000;
    }
  } catch (e) {
    // 解析失败走默认 TTL
  }
  return Date.now() + TOKEN_DEFAULT_TTL_MS;
}

/**
 * 校验字符串是否像 JWT。
 * @param {string} token
 * @returns {boolean}
 */
function isJwtLike(token) {
  return (
    typeof token === "string" &&
    /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/.test(token.trim())
  );
}

/**
 * 获取微软免费翻译临时访问令牌（带缓存）。
 * @param {boolean} [forceRefresh=false] 是否强制刷新
 * @returns {Promise<string>}
 */
async function fetchMicrosoftToken(forceRefresh) {
  if (!forceRefresh && cachedToken && Date.now() < tokenExpireAt) {
    return cachedToken;
  }
  if (tokenInflight) {
    return tokenInflight;
  }
  tokenInflight = (async function () {
    const res = await fetch(AUTH_URL, {
      method: "GET",
      headers: {
        Accept: "*/*",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(
        "无法获取微软翻译令牌（HTTP " +
          res.status +
          "），请检查网络或改用 Azure/AI"
      );
    }
    const token = (await res.text()).trim();
    if (!isJwtLike(token)) {
      throw new Error("微软翻译令牌格式无效，接口可能已变更");
    }
    cachedToken = token;
    // 提前 2 分钟过期，避免边界失效
    tokenExpireAt = getTokenExpireAt(token) - TOKEN_PRE_EXPIRE_MS;
    return token;
  })();
  try {
    return await tokenInflight;
  } finally {
    tokenInflight = null;
  }
}

/**
 * 节流：保证请求间隔。
 * @returns {Promise<void>}
 */
async function throttleRequest() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) {
    await sleep(wait);
  }
  lastRequestAt = Date.now();
}

/**
 * 写入结果缓存（带容量淘汰）。
 * @param {string} key 缓存键
 * @param {string} value 译文
 */
function putResultCache(key, value) {
  if (resultCache.size >= RESULT_CACHE_MAX) {
    // 删除最早插入的一项
    const first = resultCache.keys().next().value;
    if (first !== undefined) resultCache.delete(first);
  }
  resultCache.set(key, value);
}

/**
 * 构建缓存键。
 * @param {string} text 原文
 * @param {string} targetLang 目标语言
 * @returns {string}
 */
function makeCacheKey(text, targetLang) {
  return targetLang + "\u0000" + text;
}

/**
 * 将文本按字符与条数上限分块。
 * @param {string[]} texts 文本列表
 * @returns {string[][]}
 */
function splitTranslateBatches(texts) {
  const batches = [];
  let current = [];
  let size = 0;
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const len = t.length;
    const overflowChars = current.length && size + len > MAX_CHARS_PER_REQUEST;
    const overflowItems = current.length >= MAX_ITEMS_PER_REQUEST;
    if (overflowChars || overflowItems) {
      batches.push(current);
      current = [];
      size = 0;
    }
    // 单条超长时仍单独成批，交给服务端处理
    current.push(t);
    size += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * 解析错误响应，提取可读信息。
 * @param {Response} res
 * @returns {Promise<{ status: number, code?: number|string, message: string, isRateLimit: boolean }>}
 */
async function parseError(res) {
  let message = "HTTP " + res.status;
  let code;
  try {
    const raw = await res.text();
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data && data.error) {
          code = data.error.code;
          message = data.error.message || message;
        } else {
          message = raw.slice(0, 200);
        }
      } catch (e) {
        message = raw.slice(0, 200);
      }
    }
  } catch (e) {
    // 忽略解析失败
  }
  const isRateLimit =
    res.status === 429 ||
    code === 429001 ||
    code === 429000 ||
    /exceeded request limits|rate|quota|throttl/i.test(String(message));
  return {
    status: res.status,
    code: code,
    message: message,
    isRateLimit: isRateLimit,
  };
}

/**
 * 调用单个翻译端点。
 * @param {string} baseUrl 端点
 * @param {string} token 令牌
 * @param {string[]} texts 原文
 * @param {string} targetLang 目标语言
 * @returns {Promise<string[]>}
 */
async function postTranslate(baseUrl, token, texts, targetLang) {
  const url =
    baseUrl +
    "?" +
    new URLSearchParams({
      "api-version": "3.0",
      to: targetLang,
      includeSentenceLength: "true",
    }).toString();

  await throttleRequest();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + token,
      // 与官方 SDK/文档一致的客户端追踪头
      "X-ClientTraceId": createTraceId(),
    },
    body: JSON.stringify(
      texts.map(function (Text) {
        return { Text: Text };
      })
    ),
  });

  if (!res.ok) {
    const errInfo = await parseError(res);
    const e = new Error(errInfo.message);
    e.status = errInfo.status;
    e.code = errInfo.code;
    e.isRateLimit = errInfo.isRateLimit;
    e.endpoint = baseUrl;
    throw e;
  }

  const data = await res.json();
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error("微软翻译返回条数与请求不一致");
  }
  return data.map(function (item) {
    if (!item || !item.translations || !item.translations[0]) {
      throw new Error("微软翻译返回结构异常");
    }
    return item.translations[0].text;
  });
}

/**
 * 带端点回退与 429 重试的单批翻译。
 * @param {string[]} texts 原文批
 * @param {string} targetLang 目标语言
 * @returns {Promise<string[]>}
 */
async function translateBatchWithRetry(texts, targetLang) {
  const endpoints = [TRANSLATE_URL_PRIMARY, TRANSLATE_URL_EDGE];
  let lastError = null;
  let forceNewToken = false;

  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    // 第 0 次正常；限流后刷新令牌再试
    const token = await fetchMicrosoftToken(forceNewToken || attempt > 0);
    forceNewToken = false;

    for (let ei = 0; ei < endpoints.length; ei++) {
      try {
        return await postTranslate(endpoints[ei], token, texts, targetLang);
      } catch (err) {
        lastError = err;
        // 401/403：强制刷新令牌后换端点/重试
        if (err && (err.status === 401 || err.status === 403)) {
          forceNewToken = true;
          cachedToken = null;
          tokenExpireAt = 0;
          continue;
        }
        // 限流：先换端点，都失败再指数退避
        if (err && err.isRateLimit) {
          if (ei < endpoints.length - 1) {
            continue;
          }
          if (attempt < MAX_429_RETRIES) {
            // 0.8s, 1.6s, 3.2s, 6.4s + 抖动
            const base = 800 * Math.pow(2, attempt);
            const jitter = Math.floor(Math.random() * 400);
            await sleep(base + jitter);
            forceNewToken = true;
            break;
          }
        }
        // 非限流错误：尝试备用端点
        if (ei < endpoints.length - 1) {
          continue;
        }
      }
    }
  }

  if (lastError && lastError.isRateLimit) {
    throw new Error(
      "微软免费翻译已达速率/配额上限（429）。" +
        "建议：1) 等待几分钟后重试 2) 改用 Azure 免费密钥 3) 使用自定义 AI。" +
        "详情：" +
        (lastError.message || "request limits exceeded")
    );
  }
  throw lastError || new Error("微软免费翻译失败");
}

/**
 * 微软免 Key 翻译 Provider。
 */
const MicrosoftFreeProvider = {
  id: "microsoft-free",
  name: "微软翻译",

  /**
   * 批量翻译文本。
   * @param {string[]} texts 原文列表
   * @param {{ targetLang: string }} options 选项
   * @returns {Promise<string[]>} 译文列表
   */
  async translateTexts(texts, options) {
    const targetLang = (options && options.targetLang) || "zh-Hans";
    if (!Array.isArray(texts) || !texts.length) return [];

    // 先填缓存命中，收集未命中索引
    const results = new Array(texts.length);
    const pendingIndexes = [];
    const pendingTexts = [];

    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      // 空白片段不请求接口
      if (t == null || String(t).trim() === "") {
        results[i] = t == null ? "" : t;
        continue;
      }
      const key = makeCacheKey(t, targetLang);
      if (resultCache.has(key)) {
        results[i] = resultCache.get(key);
      } else {
        pendingIndexes.push(i);
        pendingTexts.push(t);
      }
    }

    if (!pendingTexts.length) {
      return results;
    }

    const batches = splitTranslateBatches(pendingTexts);
    let offset = 0;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const translated = await translateBatchWithRetry(batch, targetLang);
      for (let j = 0; j < batch.length; j++) {
        const globalPending = offset + j;
        const originalIndex = pendingIndexes[globalPending];
        const src = batch[j];
        const dst = translated[j];
        results[originalIndex] = dst;
        putResultCache(makeCacheKey(src, targetLang), dst);
      }
      offset += batch.length;
    }

    return results;
  },
};

if (typeof module !== "undefined") {
  module.exports = {
    MicrosoftFreeProvider,
    fetchMicrosoftToken,
    splitTranslateBatches,
    MAX_CHARS_PER_REQUEST,
    MAX_ITEMS_PER_REQUEST,
    // 测试辅助：清理状态
    __resetMicrosoftFreeState: function () {
      cachedToken = null;
      tokenExpireAt = 0;
      tokenInflight = null;
      lastRequestAt = 0;
      resultCache.clear();
    },
  };
}
