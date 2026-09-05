/**
 * `host-bench doctor` — checks that the environment is ready to benchmark
 * and explains anything that isn't, in plain words.
 */

import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";

// Individual checks are exported so tests can exercise them without a terminal.

export function checkNodeVersion(userAgent = process.version) {
  const major = Number.parseInt(userAgent.replace(/^v/, "").split(".")[0], 10);
  return {
    name: "Node.js version",
    ok: major >= 18,
    detail: `${userAgent} — host-bench needs Node 18 or newer`,
  };
}

export async function checkConfigFile(configPath) {
  try {
    const config = await loadConfig(configPath);
    const endpoints = config.sites.reduce((n, s) => n + Object.keys(s.endpoints).length, 0);
    return {
      name: "Config file",
      ok: true,
      detail: `${configPath} — ${config.sites.length} site(s), ${endpoints} endpoint(s)`,
    };
  } catch (err) {
    if (/Could not read config file/.test(err.message)) {
      return {
        name: "Config file",
        ok: null, // a missing config is fine — one-off mode needs none
        detail: `no config at "${configPath}" — that's fine: use \`host-bench init\`, \`host-bench run --url\`, or \`--local\``,
      };
    }
    return { name: "Config file", ok: false, detail: err.message };
  }
}

export async function checkResultsDir(dir = "results") {
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, ".doctor-probe");
    await writeFile(probe, "ok");
    await rm(probe);
    return { name: "Results directory", ok: true, detail: `"${dir}/" is writable` };
  } catch (err) {
    return {
      name: "Results directory",
      ok: false,
      detail: `cannot write to "${dir}/" — ${err.message}`,
    };
  }
}

export async function checkConnectivity(url = "https://example.com", timeoutMs = 5000) {
  const start = performance.now();
  try {
    await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      name: "Internet connectivity",
      ok: true,
      detail: `${url} answered in ${Math.round(performance.now() - start)} ms`,
    };
  } catch (err) {
    const cause = err && err.cause;
    const reason = (cause && (cause.code || cause.message)) || err.message;
    return {
      name: "Internet connectivity",
      ok: null, // offline is a warning, not a failure — localhost targets still work
      detail: `unreachable (${reason}) — localhost targets still work`,
    };
  }
}

export async function doctorCommand(opts) {
  console.log("host-bench doctor — checking your environment\n");

  const checks = [
    checkNodeVersion(),
    await checkConnectivity(),
    await checkConfigFile(opts.config),
    await checkResultsDir(opts.out),
  ];

  let failures = 0;
  let warnings = 0;
  for (const check of checks) {
    const mark = check.ok === true ? "ok     " : check.ok === false ? "FAIL   " : "notice ";
    if (check.ok === false) failures++;
    if (check.ok === null) warnings++;
    console.log(`${mark}${check.name}: ${check.detail}`);
  }

  console.log("");
  if (failures > 0) {
    console.log(`${failures} problem(s) found — fix the FAIL lines above, then run \`host-bench doctor\` again.`);
    process.exitCode = 1;
  } else if (warnings > 0) {
    console.log("Ready (with notices). Notices don't block benchmarking.");
  } else {
    console.log("All good — you're ready to benchmark. Try: host-bench run --local");
  }
}
