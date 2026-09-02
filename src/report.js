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

export function printTable(results) {
  const rows = results.flatMap((site) => buildRows(site));
  if (rows.length === 0) return;

  const headers = ["site", "metric", "endpoint", "avg ms", "min ms", "max ms", "ok"];
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r.cells[i]).length))
  );

  const line = (cells) =>
    cells.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();

  console.log(`\n${BOLD}results${RESET}`);
  console.log(line(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row.cells));
  console.log(
    `\n${DIM}avg/min/max = total response time over N runs; ok = successful/total requests.` +
      `\ncold = best-effort TTFB estimate of the first request (see README → Limitations).${RESET}`
  );
}

function buildRows(site) {
  const rows = [];

  rows.push(
    rowFor(site.name, "cold", site.coldStart, (s) => [fmtMs(s.ttfbMs), "-", "-", "1/1"])
  );
  rows.push(rowFor(site.name, "page", site.page, seriesCells));
  if (site.api) rows.push(rowFor(site.name, "api", site.api, seriesCells));
  if (site.db) rows.push(rowFor(site.name, "db", site.db, seriesCells));

  return rows;
}

function rowFor(siteName, metric, data, cellsFn) {
  if (!data) {
    return { siteName, metric, cells: [siteName, metric, "(not configured)", "skipped", "", "", ""] };
  }
  if (data.error != null) {
    const detail = data.lastError ?? data.error;
    return { siteName, metric, cells: [siteName, metric, shortUrl(data.url), "error", "", "", detail] };
  }
  if (data.successes === 0) {
    return { siteName, metric, cells: [siteName, metric, shortUrl(data.url), "error", "", "", data.lastError ?? "all requests failed"] };
  }
  return { siteName, metric, cells: [siteName, metric, shortUrl(data.url), ...cellsFn(data)] };
}

function seriesCells(s) {
  return [
    fmtMs(s.avgMs),
    fmtMs(s.minMs),
    fmtMs(s.maxMs),
    `${s.successes}/${s.requests}`,
  ];
}

function fmtMs(n) {
  return n == null ? "-" : String(Math.round(n));
}

function shortUrl(url) {
  if (!url) return "(not configured)";
  try {
    return new URL(url).pathname + (new URL(url).search || "");
  } catch {
    return url;
  }
}

export async function saveResults(results, outDir, meta) {
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(outDir, `host-bench-${stamp}.json`);

  const payload = {
    tool: "host-bench",
    version: meta.version,
    ranAt: new Date().toISOString(),
    config: meta.configPath,
    settings: { runs: meta.runs, timeoutMs: meta.timeoutMs },
    results,
  };

  await writeFile(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return file;
}
