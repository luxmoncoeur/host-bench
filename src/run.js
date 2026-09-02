import { createRequire } from "node:module";
import { loadConfig } from "./config.js";
import { benchmarkSite } from "./benchmark.js";
import { printProgressHeader, printTable, saveResults } from "./report.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

export async function runCommand(opts) {
  const config = opts.url ? configFromUrl(opts.url, opts) : await loadConfig(
    opts.config,
    { runs: opts.runs, timeoutMs: opts.timeout }
  );

  console.log(
    `host-bench v${version} — ${config.sites.length} site(s), ` +
      `${config.runs} run(s) per endpoint, ${config.timeoutMs} ms timeout`
  );

  const results = [];
  for (const site of config.sites) {
    printProgressHeader(site);
    results.push(await benchmarkSite(site, config, console.log));
  }

  printTable(results);

  if (opts.save) {
    const file = await saveResults(results, opts.out, {
      version,
      configPath: opts.url ? `--url ${opts.url}` : opts.config,
      runs: config.runs,
      timeoutMs: config.timeoutMs,
    });
    console.log(`\nResults saved to ${file}`);
  } else {
    console.log("\nResults not saved (--no-save).");
  }
}

// Ad-hoc single-URL mode: `host-bench run --url https://my-site.example/api/health`
function configFromUrl(url, opts) {
  if (opts.timeout != null && opts.timeout < 100) {
    throw new Error("--timeout must be at least 100 ms.");
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`--url must be a valid URL (got "${url}").`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`--url must start with http:// or https:// (got "${url}").`);
  }

  const page = (u.pathname === "" ? "/" : u.pathname) + u.search;
  return {
    runs: opts.runs ?? 5,
    timeoutMs: opts.timeout ?? 10000,
    sites: [
      {
        name: u.host,
        baseUrl: u.origin,
        endpoints: { page: page === "" ? "/" : page },
      },
    ],
  };
}
