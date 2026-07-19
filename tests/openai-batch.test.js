const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTranslationArray,
  buildBatchMessages,
  createOpenAICompatibleProvider,
} = require("../src/background/providers/openai-compatible.js");
const {
  chunkTexts,
  translateAllTexts,
} = require("../src/background/translate-service.js");

describe("parseTranslationArray", () => {
  it("解析纯 JSON 数组", () => {
    assert.deepEqual(parseTranslationArray('["你好","世界"]'), ["你好", "世界"]);
  });

  it("解析代码围栏中的 JSON", () => {
    const raw = '```json\n["a","b"]\n```';
    assert.deepEqual(parseTranslationArray(raw), ["a", "b"]);
  });

  it("解析夹杂说明文字的数组", () => {
    const raw = '如下：\n["一","二"]\n完成';
    assert.deepEqual(parseTranslationArray(raw), ["一", "二"]);
  });

  it("兼容对象元素", () => {
    assert.deepEqual(parseTranslationArray('[{"text":"好"},{"translation":"的"}]'), [
      "好",
      "的",
    ]);
  });

  it("空内容抛错", () => {
    assert.throws(() => parseTranslationArray(""), /空结果/);
  });

  it("无法解析时抛错", () => {
    assert.throws(() => parseTranslationArray("不是数组"), /无法解析/);
  });
});

describe("buildBatchMessages", () => {
  it("user 内容为 JSON 数组字符串", () => {
    const msgs = buildBatchMessages(["Hello", "World"], "zh-Hans");
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[1].role, "user");
    assert.equal(msgs[1].content, JSON.stringify(["Hello", "World"]));
    assert.match(msgs[0].content, /zh-Hans/);
  });

  it("strict 提示更强调只输出 JSON", () => {
    const msgs = buildBatchMessages(["x"], "en", { strict: true });
    assert.match(msgs[0].content, /必须只输出/);
  });
});

describe("createOpenAICompatibleProvider 批量请求", () => {
  it("一次请求翻译多段并校验条数", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function (url, init) {
      calls.push({ url, body: JSON.parse(init.body) });
      return {
        status: 200,
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(["你好", "世界", "！"]),
                },
              },
            ],
          };
        },
      };
    };
    try {
      const provider = createOpenAICompatibleProvider({
        openaiBaseUrl: "https://api.example.com/v1",
        openaiApiKey: "sk-test",
        openaiModel: "demo-model",
      });
      const out = await provider.translateTexts(["Hello", "World", "!"], {
        targetLang: "zh-Hans",
      });
      assert.deepEqual(out, ["你好", "世界", "！"]);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
      assert.equal(calls[0].body.model, "demo-model");
      assert.equal(
        calls[0].body.messages[1].content,
        JSON.stringify(["Hello", "World", "!"])
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("格式错误时严格提示重试一次", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async function (_url, init) {
      calls.push(JSON.parse(init.body));
      if (calls.length === 1) {
        return {
          status: 200,
          ok: true,
          async json() {
            return { choices: [{ message: { content: "乱说一通" } }] };
          },
        };
      }
      return {
        status: 200,
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: '["译A","译B"]' } }],
          };
        },
      };
    };
    try {
      const provider = createOpenAICompatibleProvider({
        openaiBaseUrl: "https://api.example.com/v1",
        openaiApiKey: "sk-test",
        openaiModel: "demo",
      });
      const out = await provider.translateTexts(["A", "B"], { targetLang: "zh-Hans" });
      assert.deepEqual(out, ["译A", "译B"]);
      assert.equal(calls.length, 2);
      assert.match(calls[1].messages[0].content, /必须只输出/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("声明更大分块上限", () => {
    const provider = createOpenAICompatibleProvider({
      openaiBaseUrl: "https://api.example.com/v1",
      openaiApiKey: "k",
      openaiModel: "m",
    });
    assert.equal(provider.maxChunkChars, 12000);
    assert.equal(provider.maxChunkItems, 80);
  });
});

describe("translateAllTexts 尊重 provider 分块", () => {
  it("AI 大分块时整批一次调用", async () => {
    let callCount = 0;
    const provider = {
      maxChunkChars: 12000,
      maxChunkItems: 80,
      async translateTexts(texts) {
        callCount += 1;
        return texts.map((t) => "T:" + t);
      },
    };
    const texts = Array.from({ length: 50 }, (_, i) => "seg" + i);
    const out = await translateAllTexts(provider, texts, { targetLang: "zh-Hans" });
    assert.equal(callCount, 1);
    assert.equal(out.length, 50);
    assert.equal(out[0], "T:seg0");
  });

  it("默认分块仍按 40 条", () => {
    const texts = Array.from({ length: 45 }, (_, i) => "t" + i);
    const chunks = chunkTexts(texts, 99999, 40);
    assert.equal(chunks.length, 2);
  });
});
