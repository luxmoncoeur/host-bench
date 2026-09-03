/**
 * `host-bench show` — pretty-print a saved run from the results directory
 * without re-benchmarking.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { printTable } from "./report.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function showCommand(fileArg, opts) {
  const dir = opts.dir;
  let file = fileArg ?? "latest";

  if (file === "latest") {
    const files = (await readdir(dir)).filter((f) => /^host-bench-.*\.json$/.test(f)).sort();
    if (files.length === 0) {
      throw new Error(`No saved runs in "${dir}" — run \`host-bench run\` first (or pass --dir).`);
    }
    file = files[files.length - 1];
  }

  const fullPath = path.join(dir, file);
  let payload;
  try {
    payload = JSON.parse(await readFile(fullPath, "utf8"));
  } catch (err) {
    throw new Error(`Could not read result file "${fullPath}": ${err.message}`);
  }
  if (!payload || payload.tool !== "host-bench" || !Array.isArray(payload.results)) {
    throw new Error(`"${fullPath}" is not a host-bench result file.`);
  }

  const settings = payload.settings ?? {};
  console.log(
    `${BOLD}host-bench v${payload.version} run${RESET} ${DIM}${payload.ranAt} · config: ${payload.config} · ` +
      `${settings.runs ?? "?"} run(s) · ${settings.timeoutMs ?? "?"} ms timeout` +
      (settings.warmup ? ` · ${settings.warmup} warmup` : "") +
      (settings.delayMs ? ` · ${settings.delayMs} ms delay` : "") +
      `${RESET}`
  );
  printTable(payload.results);
}
