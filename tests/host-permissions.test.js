const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  originPatternFromUrl,
} = require("../src/shared/host-permissions.js");

describe("originPatternFromUrl", () => {
  it("从 https Base URL 生成 origin/*", () => {
    assert.equal(
      originPatternFromUrl("https://api.openai.com/v1"),
      "https://api.openai.com/*"
    );
  });

  it("去掉尾部路径后仍取 origin", () => {
    assert.equal(
      originPatternFromUrl("https://example.com:8443/foo/bar"),
      "https://example.com:8443/*"
    );
  });

  it("非法 URL 返回 null", () => {
    assert.equal(originPatternFromUrl("not-a-url"), null);
    assert.equal(originPatternFromUrl(""), null);
  });

  it("拒绝非 http(s) 协议", () => {
    assert.equal(originPatternFromUrl("ftp://example.com/x"), null);
  });
});