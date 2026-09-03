import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "../src/run.js";
import { buildMarkdown } from "../src/compare.js";

test("gate fails endpoints over budget and all-failed endpoints", () => {
  const results = [
    {
      name: "app",
      endpoints: {
        page: { avgMs: 150, successes: 2 },
        api: { avgMs: 50, successes: 2 },
        dead: { avgMs: null, successes: 0, lastError: "HTTP 500" },
      },
    },
  ];

  const gate = evaluateGate(results, 100);
  assert.equal(gate.passed, false);
  assert.equal(gate.failOver, 100);
  assert.deepEqual(gate.violations, [
    "app:page — avg 150 ms > 100 ms budget",
    "app:dead — all requests failed (HTTP 500)",
  ]);
});

test("gate passes when everything is within budget", () => {
  const results = [
    { name: "app", endpoints: { page: { avgMs: 99.9, successes: 5 } } },
  ];
  assert.deepEqual(evaluateGate(results, 100), {
    failOver: 100,
    passed: true,
    violations: [],
  });
});

test("markdown output is a valid GitHub table", () => {
  const md = buildMarkdown(
    ["site", "metric", "runs"],
    [
      ["app", "page", "3"],
      ["weird | name", "cold", "1"],
    ]
  );
  assert.equal(
    md,
    "| site | metric | runs |\n| --- | --- | --- |\n| app | page | 3 |\n| weird \\| name | cold | 1 |"
  );
});
