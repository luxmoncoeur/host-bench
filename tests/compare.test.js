import { test } from "node:test";
import assert from "node:assert/strict";
import { buildComparison } from "../src/compare.js";

const older = {
  ranAt: "2026-09-01T10:00:00.000Z",
  results: [
    {
      name: "app",
      baseUrl: "https://app.example",
      coldStart: { url: "https://app.example/", ttfbMs: 400 },
      // pre-0.3.0 result shape: series at the top level
      page: { url: "https://app.example/", avgMs: 100, minMs: 80 },
      api: null,
    },
  ],
};

const newer = {
  ranAt: "2026-09-02T10:00:00.000Z",
  results: [
    {
      name: "app",
      baseUrl: "https://app.example",
      coldStart: { url: "https://app.example/", ttfbMs: 300 },
      // current result shape: series under endpoints
      endpoints: {
        page: { url: "https://app.example/", avgMs: 90, minMs: 70 },
      },
    },
  ],
};

test("compares cold + endpoint metrics across runs, old and new shapes alike", () => {
  const rows = buildComparison([older, newer]);
  const byKey = Object.fromEntries(rows.map((r) => [`${r[0]}:${r[1]}`, r]));

  assert.deepEqual(rows.map((r) => `${r[0]}:${r[1]}`).sort(), ["app:cold", "app:page"]);

  const cold = byKey["app:cold"];
  assert.equal(cold[2], "2"); // runs
  assert.equal(cold[3], "400"); // first avg
  assert.equal(cold[4], "300"); // latest avg
  assert.equal(cold[5], "-100 ms (-25%)");
  assert.equal(cold[6], "-"); // cold has no min

  const page = byKey["app:page"];
  assert.equal(page[3], "100");
  assert.equal(page[4], "90");
  assert.equal(page[5], "-10 ms (-10%)");
  assert.equal(page[6], "70"); // best min across both runs
});

test("increases are shown with a plus sign", () => {
  const rows = buildComparison([
    {
      ranAt: "1",
      results: [
        { name: "s", coldStart: { ttfbMs: 100 }, endpoints: { page: { avgMs: 50, minMs: 40 } } },
      ],
    },
    {
      ranAt: "2",
      results: [
        { name: "s", coldStart: { ttfbMs: 250 }, endpoints: { page: { avgMs: 75, minMs: 40 } } },
      ],
    },
  ]);
  const page = rows.find((r) => r[1] === "page");
  assert.equal(page[5], "+25 ms (+50%)");
});

test("metrics that never succeeded are skipped", () => {
  const rows = buildComparison([
    {
      ranAt: "1",
      results: [
        {
          name: "s",
          coldStart: { error: "HTTP 500" },
          endpoints: { page: { avgMs: null, minMs: null, successes: 0, lastError: "HTTP 500" } },
        },
      ],
    },
  ]);
  assert.deepEqual(rows, []);
});
