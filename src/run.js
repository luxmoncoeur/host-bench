import { createRequire } from "node:module";
import { loadConfig, configFromUrl } from "./config.js";
import { benchmarkSite } from "./benchmark.js";
import { printProgressHeader, printTable, saveResults, buildPayload } from "./report.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export async function runCommand(opts) {
  const config = opts.url
    ? configFromUrl(opts.url, { runs: opts.runs, timeoutMs: opts.timeout, name: opts.name })
    : await loadConfig(opts.config, { runs: opts.runs, timeoutMs: opts.timeout });

  const meta = {
    version,
    configPath: opts.url ? `--url ${opts.url}` : opts.config,
    runs: config.runs,
    timeoutMs: config.timeoutMs,
  };

  const json = opts.json === true;
  if (!json) {
    console.log(
      `host-bench v${version} — ${config.sites.length} site(s), ` +
        `${config.runs} run(s) per endpoint, ${config.timeoutMs} ms timeout`
    );
  }

  const results = [];
  for (const site of config.sites) {
    if (!json) printProgressHeader(site);
    results.push(await benchmarkSite(site, config, json ? () => {} : console.log));
  }

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
}
