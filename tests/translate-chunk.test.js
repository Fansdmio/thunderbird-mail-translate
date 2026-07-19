const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { chunkTexts } = require("../src/background/translate-service.js");

describe("chunkTexts", () => {
  it("按字符上限分块", () => {
    const chunks = chunkTexts(["aaaa", "bbbb", "c"], 6);
    assert.deepEqual(chunks, [["aaaa"], ["bbbb", "c"]]);
  });
});
