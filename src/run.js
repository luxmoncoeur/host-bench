import { createRequire } from "node:module";
import { loadConfig, configFromUrl } from "./config.js";
import { benchmarkSite } from "./benchmark.js";
import { printProgressHeader, printTable, saveResults, buildPayload } from "./report.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export async function runCommand(opts) {
  const config = opts.url
    ? configFromUrl(opts.url, {
        runs: opts.runs,
        timeoutMs: opts.timeout,
        warmup: opts.warmup,
        delayMs: opts.delay,
        name: opts.name,
      })
    : await loadConfig(opts.config, {
        runs: opts.runs,
        timeoutMs: opts.timeout,
        warmup: opts.warmup,
        delayMs: opts.delay,
      });

  const json = opts.json === true;
  if (!json) {
    console.log(
      `host-bench v${version} — ${config.sites.length} site(s), ` +
        `${config.runs} run(s) per endpoint, ${config.timeoutMs} ms timeout` +
        (config.warmup > 0 ? `, ${config.warmup} warmup` : "") +
        (config.delayMs > 0 ? `, ${config.delayMs} ms delay` : "")
    );
  }

  const results = [];
  for (const site of config.sites) {
    if (!json) printProgressHeader(site);
    results.push(await benchmarkSite(site, config, json ? () => {} : console.log));
  }

  const gate = opts.failOver != null ? evaluateGate(results, opts.failOver) : null;

  const meta = {
    version,
    configPath: opts.url ? `--url ${opts.url}` : opts.config,
    runs: config.runs,
    timeoutMs: config.timeoutMs,
    warmup: config.warmup,
    delayMs: config.delayMs,
    gate,
  };

  if (json) {
    console.log(JSON.stringify(buildPayload(results, meta), null, 2));
  } else {
    printTable(results);
  }

  if (opts.save) {
    const file = await saveResults(results, opts.out, meta);
    (json ? console.error : console.log)(`\nResults saved to ${file}`);
  } else if (!json) {
    console.log("\nResults not saved (--no-save).");
  }

  if (gate) {
    if (gate.passed) {
      (json ? console.error : console.log)(`\nPerformance gate passed (budget ${opts.failOver} ms).`);
    } else {
      const say = json ? console.error : console.log;
      say(`\nPerformance gate FAILED (budget ${opts.failOver} ms):`);
      for (const violation of gate.violations) say(`  - ${violation}`);
      process.exitCode = 2;
    }
  }
}

// CI gate: fails when any endpoint's average exceeds the budget or when all
// of an endpoint's requests failed. Cold-start TTFB is excluded on purpose —
// it is a noisy one-shot estimate.
export function evaluateGate(results, failOver) {
  const violations = [];
  for (const site of results ?? []) {
    for (const [key, series] of Object.entries(site.endpoints ?? {})) {
      if (series.successes === 0) {
        violations.push(
          `${site.name}:${key} — all requests failed (${series.lastError ?? "unknown error"})`
        );
      } else if (series.avgMs != null && series.avgMs > failOver) {
        violations.push(
          `${site.name}:${key} — avg ${Math.round(series.avgMs)} ms > ${failOver} ms budget`
        );
      }
    }
  }
  return { failOver, passed: violations.length === 0, violations };
}
