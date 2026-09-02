/**
 * Benchmark logic. Every metric is measured with plain HTTP GETs:
 *
 *   - TTFB  = time from request start until response headers arrive.
 *   - total = time until the response body has fully arrived.
 *
 * Cold start is a best-effort estimate: host-bench cannot know whether the
 * provider has spun the app down, so "cold" is simply the TTFB of the very
 * first request of a run (see README → Limitations).
 */

const USER_AGENT = "host-bench/0.1.0";

export async function benchmarkSite(site, { runs, timeoutMs }, log) {
  const result = {
    name: site.name,
    baseUrl: site.baseUrl,
    coldStart: null,
    page: null,
    api: null,
    db: null,
  };

  // Cold-start probe. Also doubles as warm-up, so the series below measure
  // warm performance.
  const pageUrl = site.baseUrl + site.endpoints.page;
  const probe = await timedFetch(pageUrl, timeoutMs);
  if (probe.ok) {
    result.coldStart = {
      url: pageUrl,
      status: probe.status,
      ttfbMs: round1(probe.ttfbMs),
      totalMs: round1(probe.totalMs),
    };
    log(fmtLine("cold", site.endpoints.page, `TTFB ${Math.round(probe.ttfbMs)} ms (status ${probe.status})`));
  } else {
    result.coldStart = { url: pageUrl, error: probe.error };
    log(fmtLine("cold", site.endpoints.page, `error — ${probe.error}`));
  }

  result.page = await runSeries("page", pageUrl, runs, timeoutMs, log);

  if (site.endpoints.api) {
    result.api = await runSeries("api", site.baseUrl + site.endpoints.api, runs, timeoutMs, log);
  } else {
    log(fmtLine("api", null, "skipped — not configured"));
  }
  if (site.endpoints.db) {
    result.db = await runSeries("db", site.baseUrl + site.endpoints.db, runs, timeoutMs, log);
  } else {
    log(fmtLine("db", null, "skipped — not configured"));
  }

  return result;
}

async function runSeries(label, url, runs, timeoutMs, log) {
  const totals = [];
  const ttfbs = [];
  const errors = [];

  for (let i = 0; i < runs; i++) {
    const r = await timedFetch(url, timeoutMs);
    if (r.ok) {
      totals.push(r.totalMs);
      ttfbs.push(r.ttfbMs);
    } else {
      errors.push(r.error);
    }
  }

  const series = {
    url,
    requests: runs,
    successes: totals.length,
    errors: errors.length,
    avgMs: null,
    minMs: null,
    maxMs: null,
    avgTtfbMs: null,
    lastError: errors.length ? errors[errors.length - 1] : null,
  };

  if (totals.length > 0) {
    series.avgMs = round1(mean(totals));
    series.minMs = round1(Math.min(...totals));
    series.maxMs = round1(Math.max(...totals));
    series.avgTtfbMs = round1(mean(ttfbs));
    log(
      fmtLine(
        label,
        new URL(url).pathname,
        `avg ${Math.round(series.avgMs)} ms · min ${Math.round(series.minMs)} · max ${Math.round(
          series.maxMs
        )} · ${totals.length}/${runs} ok`
      )
    );
  } else {
    log(fmtLine(label, new URL(url).pathname, `error — ${errors[0] ?? "all requests failed"}`));
  }

  return series;
}

async function timedFetch(url, timeoutMs) {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT },
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

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (n) => Math.round(n * 10) / 10;

function fmtLine(label, path, message) {
  const target = path == null ? "" : ` ${path}`;
  return `  ${label.padEnd(4)}${target} — ${message}`;
}
