const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { chunkTexts } = require("../src/background/translate-service.js");
const {
  splitTranslateBatches,
  MAX_ITEMS_PER_REQUEST,
  __resetMicrosoftFreeState,
} = require("../src/background/providers/microsoft-free.js");

describe("chunkTexts", () => {
  it("按字符上限分块", () => {
    const chunks = chunkTexts(["aaaa", "bbbb", "c"], 6);
    assert.deepEqual(chunks, [["aaaa"], ["bbbb", "c"]]);
  });

  it("按条数上限分块", () => {
    const texts = Array.from({ length: 45 }, (_, i) => "t" + i);
    const chunks = chunkTexts(texts, 99999, 40);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, 40);
    assert.equal(chunks[1].length, 5);
  });
});

describe("splitTranslateBatches", () => {
  it("按条数拆分", () => {
    __resetMicrosoftFreeState();
    const texts = Array.from({ length: MAX_ITEMS_PER_REQUEST + 3 }, (_, i) => "x" + i);
    const batches = splitTranslateBatches(texts);
    assert.equal(batches[0].length, MAX_ITEMS_PER_REQUEST);
    assert.equal(batches[1].length, 3);
  });
});
