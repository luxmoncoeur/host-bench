/**
 * Benchmark logic. Every metric is measured with real HTTP requests:
 *
 *   - TTFB  = time from request start until response headers arrive.
 *   - total = time until the response body has fully arrived.
 *
 * Cold start is a best-effort estimate: host-bench cannot know whether the
 * provider has spun the app down, so "cold" is simply the TTFB of the very
 * first request of a run (see README → Limitations).
 */

import { createRequire } from "node:module";
import { mean, percentile, round1 } from "./stats.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const USER_AGENT = `host-bench/${pkg.version}`;

export async function benchmarkSite(site, { runs, timeoutMs }, log) {
  const result = { name: site.name, baseUrl: site.baseUrl, coldStart: null, endpoints: {} };

  // Cold-start probe on the page route. Doubles as warm-up, so the series
  // below measure warm performance.
  const page = site.endpoints.page ?? { path: "/", method: "GET", headers: {}, body: null };
  const pageUrl = site.baseUrl + page.path;
  const probe = await timedFetch(pageUrl, buildRequest(site, page), timeoutMs);
  if (probe.ok) {
    result.coldStart = {
      url: pageUrl,
      method: page.method,
      status: probe.status,
      ttfbMs: round1(probe.ttfbMs),
      totalMs: round1(probe.totalMs),
    };
    log(fmtLine("cold", target(page), `TTFB ${Math.round(probe.ttfbMs)} ms (status ${probe.status})`));
  } else {
    result.coldStart = { url: pageUrl, method: page.method, error: probe.error };
    log(fmtLine("cold", target(page), `error — ${probe.error}`));
  }

  for (const [key, endpoint] of Object.entries(site.endpoints)) {
    result.endpoints[key] = await runSeries(key, site, endpoint, runs, timeoutMs, log);
  }

  return result;
}

async function runSeries(key, site, endpoint, runs, timeoutMs, log) {
  const url = site.baseUrl + endpoint.path;
  const request = buildRequest(site, endpoint);
  const totals = [];
  const ttfbs = [];
  const errors = [];

  for (let i = 0; i < runs; i++) {
    const r = await timedFetch(url, request, timeoutMs);
    if (r.ok) {
      totals.push(r.totalMs);
      ttfbs.push(r.ttfbMs);
    } else {
      errors.push(r.error);
    }
  }

  const series = {
    url,
    method: request.method,
    requests: runs,
    successes: totals.length,
    errors: errors.length,
    avgMs: totals.length ? round1(mean(totals)) : null,
    minMs: totals.length ? round1(Math.min(...totals)) : null,
    maxMs: totals.length ? round1(Math.max(...totals)) : null,
    p95Ms: totals.length ? round1(percentile(totals, 95)) : null,
    avgTtfbMs: ttfbs.length ? round1(mean(ttfbs)) : null,
    lastError: errors.length ? errors[errors.length - 1] : null,
  };

  if (totals.length > 0) {
    log(
      fmtLine(
        key,
        target(endpoint),
        `avg ${Math.round(series.avgMs)} ms · min ${Math.round(series.minMs)} · max ${Math.round(
          series.maxMs
        )} · p95 ${Math.round(series.p95Ms)} · ${totals.length}/${runs} ok`
      )
    );
  } else {
    log(fmtLine(key, target(endpoint), `error — ${errors[0] ?? "all requests failed"}`));
  }

  return series;
}

// Merges site-level headers with per-endpoint headers and applies JSON defaults.
function buildRequest(site, endpoint) {
  const method = endpoint.method || "GET";
  const headers = { ...site.headers, ...endpoint.headers, "user-agent": USER_AGENT };
  // Config normalization already stringifies object bodies, but stringify here
  // too so benchmarkSite stays correct for any caller.
  const body =
    endpoint.body == null ? null : typeof endpoint.body === "string" ? endpoint.body : JSON.stringify(endpoint.body);
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  return { method, headers, body: hasBody ? body : undefined };
}

async function timedFetch(url, request, timeoutMs) {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ttfbMs = performance.now() - start;
    // Drain the body so "total" includes transfer time, not just headers.
    await res.arrayBuffer();
    const totalMs = performance.now() - start;

    if (res.ok) {
      return { ok: true, status: res.status, ttfbMs, totalMs };
    }
    return {
      ok: false,
      error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
      ttfbMs,
      totalMs,
    };
  } catch (err) {
    if (err && err.name === "TimeoutError") {
      return { ok: false, error: `timed out after ${timeoutMs} ms` };
    }
    const cause = err && err.cause;
    return { ok: false, error: (cause && (cause.code || cause.message)) || err.message };
  }
}

function target(endpoint) {
  const path = endpoint.path ?? "(unknown)";
  return endpoint.method && endpoint.method !== "GET" ? `${endpoint.method} ${path}` : path;
}

function fmtLine(label, targetPath, message) {
  return `  ${label.padEnd(4)} ${targetPath} — ${message}`;
}
