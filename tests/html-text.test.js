const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  extractTextSegments,
  applyTextSegments,
} = require("../src/shared/html-text.js");

describe("html-text", () => {
  it("抽取并回填简单 HTML", () => {
    const html = "<p>Hello <b>World</b></p>";
    const { segments, skeleton } = extractTextSegments(html);
    assert.deepEqual(segments, ["Hello ", "World"]);
    const out = applyTextSegments(skeleton, ["你好 ", "世界"]);
    assert.match(out, /你好/);
    assert.match(out, /世界/);
    assert.match(out, /<b>/);
  });

  it("跳过 script 与 style", () => {
    const html = "<style>.a{}</style><p>Hi</p><script>x=1</script>";
    const { segments } = extractTextSegments(html);
    assert.deepEqual(segments, ["Hi"]);
  });

  it("纯空白片段不进入翻译列表", () => {
    const html = "<p>A</p><p>   </p><p>B</p>";
    const { segments } = extractTextSegments(html);
    assert.deepEqual(segments, ["A", "B"]);
  });
});
