import { test } from "node:test";
import assert from "node:assert/strict";
import { mean, percentile, round1 } from "../src/stats.js";

test("mean averages the samples", () => {
  assert.equal(mean([10, 20, 30]), 20);
  assert.equal(mean([5]), 5);
});

test("percentile uses nearest-rank", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 95), 50);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 95), 19);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([30, 10, 20], 50), 20); // unsorted input is sorted internally
});

test("percentile of an empty sample is null", () => {
  assert.equal(percentile([], 95), null);
});

test("round1 keeps one decimal", () => {
  assert.equal(round1(1.25), 1.3);
  assert.equal(round1(100), 100);
});
