/**
 * Terminal table rendering and timestamped JSON storage for run results.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function printProgressHeader(site) {
  console.log(`\n${BOLD}${site.name}${RESET} ${DIM}${site.baseUrl}${RESET}`);
}

export function renderTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const line = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

export function printTable(results) {
  const rows = results.flatMap((site) => buildRows(site));
  if (rows.length === 0) return;

  console.log(`\n${BOLD}results${RESET}`);
  renderTable(
    ["site", "metric", "endpoint", "avg ms", "min ms", "max ms", "p95 ms", "ok"],
    rows
  );
  console.log(
    `\n${DIM}avg/min/max/p95 = total response time over N runs; ok = successful/total requests.` +
      `\ncold = best-effort TTFB estimate of the first request (see README → Limitations).${RESET}`
  );
}

function buildRows(site) {
  const rows = [];
  const cold = site.coldStart;
  if (cold && cold.error == null) {
    rows.push([site.name, "cold", target(cold), fmtMs(cold.ttfbMs), "-", "-", "-", "1/1"]);
  } else if (cold) {
    rows.push([site.name, "cold", target(cold), "error", "-", "-", "-", cold.error]);
  }

  for (const [key, series] of Object.entries(site.endpoints ?? {})) {
    const t = target(series);
    if (series.successes === 0) {
      rows.push([site.name, key, t, "error", "-", "-", "-", series.lastError ?? "all requests failed"]);
    } else {
      rows.push([
        site.name,
        key,
        t,
        fmtMs(series.avgMs),
        fmtMs(series.minMs),
        fmtMs(series.maxMs),
        fmtMs(series.p95Ms),
        `${series.successes}/${series.requests}`,
      ]);
    }
  }
  return rows;
}

function target(series) {
  const path = series.url ? shortUrl(series.url) : "(not configured)";
  return series.method && series.method !== "GET" ? `${series.method} ${path}` : path;
}

function fmtMs(n) {
  return n == null ? "-" : String(Math.round(n));
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + (u.search || "");
  } catch {
    return url;
  }
}

export function buildPayload(results, meta) {
  return {
    tool: "host-bench",
    version: meta.version,
    ranAt: new Date().toISOString(),
    config: meta.configPath,
    settings: {
      runs: meta.runs,
      timeoutMs: meta.timeoutMs,
      warmup: meta.warmup ?? 0,
      delayMs: meta.delayMs ?? 0,
    },
    ...(meta.gate ? { gate: meta.gate } : {}),
    results,
  };
}

export async function saveResults(results, outDir, meta) {
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outDir, `host-bench-${stamp}.json`);

  await writeFile(file, JSON.stringify(buildPayload(results, meta), null, 2) + "\n", "utf8");
  return file;
}
