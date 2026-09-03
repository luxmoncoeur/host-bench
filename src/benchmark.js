/**
 * Benchmark logic. Every metric is measured with real HTTP requests:
 *
 *   - TTFB    = time from request start until response headers arrive.
 *   - total   = time until the response body has fully arrived.
 *   - connect = socket setup (DNS + TCP + TLS) when a new connection was
 *               needed; null when the pool reused an existing connection.
 *
 * Cold start is a best-effort estimate: host-bench cannot know whether the
 * provider has spun the app down, so "cold" is simply the TTFB of the very
 * first request of a run (see README → Limitations).
 */

import { createRequire } from "node:module";
import diagnostics_channel from "node:diagnostics_channel";
import { mean, percentile, round1 } from "./stats.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const USER_AGENT = `host-bench/${pkg.version}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Connection attribution via undici's diagnostics channels. Requests run
// sequentially, so any connect that completes during a request belongs to it.
const beforeConnect = diagnostics_channel.channel("undici:client:beforeConnect");
const connected = diagnostics_channel.channel("undici:client:connected");
const connection = { connecting: false, startedAt: 0, ms: null, seenThisRequest: false };
beforeConnect.subscribe(() => {
  connection.connecting = true;
  connection.startedAt = performance.now();
});
connected.subscribe(() => {
  if (connection.connecting) {
    connection.connecting = false;
    connection.ms = performance.now() - connection.startedAt;
    connection.seenThisRequest = true;
  }
});

export async function benchmarkSite(site, { runs, timeoutMs, warmup = 0, delayMs = 0 }, log) {
  const result = { name: site.name, baseUrl: site.baseUrl, coldStart: null, endpoints: {} };

  // Accept both pre-normalized endpoints and raw string paths, so callers
  // don't need to run the config layer first.
  const endpoints = {};
  for (const [key, value] of Object.entries(site.endpoints ?? {})) {
    endpoints[key] = asEndpoint(value);
  }

  // Cold-start probe on the page route. Doubles as warm-up, so the series
  // below measure warm performance.
  const page = endpoints.page ?? { path: "/", method: "GET", headers: {}, body: null, expect: null };
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

  for (const [key, endpoint] of Object.entries(endpoints)) {
    result.endpoints[key] = await runSeries(key, site, endpoint, { runs, timeoutMs, warmup, delayMs }, log);
  }

  return result;
}

function asEndpoint(value) {
  if (typeof value === "string") {
    return { path: value, method: "GET", headers: {}, body: null, expect: null };
  }
  return value ?? { path: "/", method: "GET", headers: {}, body: null, expect: null };
}

async function runSeries(key, site, endpoint, { runs, timeoutMs, warmup, delayMs }, log) {
  const url = site.baseUrl + endpoint.path;
  const request = buildRequest(site, endpoint);
  const totals = [];
  const ttfbs = [];
  const bytes = [];
  const connects = [];
  const errors = [];
  const statuses = {};
  let newConnections = 0;
  let reusedRequests = 0;

  const totalRequests = warmup + runs;
  for (let i = 0; i < totalRequests; i++) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);
    const measured = i >= warmup;

    const r = await timedFetch(url, request, timeoutMs);
    if (r.status != null) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    if (r.connectMs != null) {
      newConnections++;
      if (measured) connects.push(r.connectMs);
    } else if (r.status != null) {
      reusedRequests++;
    }

    if (!measured) continue;
    if (r.ok) {
      totals.push(r.totalMs);
      ttfbs.push(r.ttfbMs);
      bytes.push(r.bytes);
    } else {
      errors.push(r.error);
    }
  }

  const series = {
    url,
    method: request.method,
    requests: runs,
    warmup,
    successes: totals.length,
    errors: errors.length,
    avgMs: totals.length ? round1(mean(totals)) : null,
    minMs: totals.length ? round1(Math.min(...totals)) : null,
    maxMs: totals.length ? round1(Math.max(...totals)) : null,
    p50Ms: totals.length ? round1(percentile(totals, 50)) : null,
    p95Ms: totals.length ? round1(percentile(totals, 95)) : null,
    p99Ms: totals.length ? round1(percentile(totals, 99)) : null,
    avgTtfbMs: ttfbs.length ? round1(mean(ttfbs)) : null,
    avgBytes: bytes.length ? round1(mean(bytes)) : null,
    avgConnectMs: connects.length ? round1(mean(connects)) : null,
    newConnections,
    reusedRequests,
    statuses,
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
    endpoint.body == null
      ? null
      : typeof endpoint.body === "string"
        ? endpoint.body
        : JSON.stringify(endpoint.body);
  const hasBody = body != null && method !== "GET" && method !== "HEAD";
  if (hasBody && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  return { method, headers, body: hasBody ? body : undefined, expectStatus: endpoint.expect?.status ?? null };
}

async function timedFetch(url, request, timeoutMs) {
  connection.seenThisRequest = false;
  connection.ms = null;
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
    const buf = await res.arrayBuffer();
    const totalMs = performance.now() - start;

    const base = {
      status: res.status,
      bytes: buf.byteLength,
      connectMs: connection.seenThisRequest ? connection.ms : null,
    };

    if (res.ok && (request.expectStatus == null || res.status === request.expectStatus)) {
      return { ok: true, ttfbMs, totalMs, ...base };
    }
    const error =
      request.expectStatus != null && res.status !== request.expectStatus
        ? `HTTP ${res.status} (expected ${request.expectStatus})`
        : `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`;
    return { ok: false, error, ttfbMs, totalMs, ...base };
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
