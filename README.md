# host-bench

A small CLI that benchmarks hosting providers (Vercel, Railway, Render, Fly.io) for a **dynamic site's** performance, so you can compare how the same app behaves on different hosts — with numbers, not opinions.

It hits your deployed site's pages, API routes, and DB-backed routes with real HTTP requests, prints a comparison table (avg / min / max / p95), and saves every run as timestamped JSON so you can track performance over time.

Requires **Node.js 18+** (uses the built-in `fetch`).

---

## Demo

```bash
# 1. No install, no config: benchmark any URL one-off
npx host-bench run --url https://your-site.vercel.app

# 2. The out-of-the-box flow: scaffold a working config, then run it
host-bench init
host-bench run

# 3. Every run is saved as JSON — compare them over time
host-bench compare
```

That's the whole product: measure → save → compare. Everything below is the details.

---

## Install

```bash
# global install from npm (once published)
npm install -g host-bench

# …or run it directly without installing
npx host-bench run

# …or, from a clone of this repo, link it as the global `host-bench` command
npm link
```

## Quickstart

**1. Scaffold a config.** `init` writes `host-bench.config.json` with a demo entry (example.com), so your very first run succeeds before you have a site of your own:

```bash
host-bench init
```

**2. Point it at your sites.** Edit `baseUrl` (and add `api` / `db` endpoints if you have them — see [Config file](#config-file)):

```json
{
  "runs": 5,
  "timeoutMs": 10000,
  "sites": [
    { "name": "vercel", "baseUrl": "https://my-app.vercel.app", "endpoints": { "page": "/", "api": "/api/health" } },
    { "name": "railway", "baseUrl": "https://my-app.up.railway.app", "endpoints": { "page": "/" } }
  ]
}
```

**3. Run it.**

```bash
host-bench run
```

Real output (benchmarked against a deployed static game, 5 runs):

```
host-bench v0.3.0 — 1 site(s), 5 run(s) per endpoint, 10000 ms timeout

snake  https://slitherin-game.vercel.app
  cold / — TTFB 197 ms (status 200)
  page / — avg 62 ms · min 34 · max 169 · p95 169 · 5/5 ok

results
site   metric  endpoint  avg ms  min ms  max ms  p95 ms  ok
-----  ------  --------  ------  ------  ------  ------  ---
snake  cold    /         197     -       -       -       1/1
snake  page    /         62      34      169     169     5/5

avg/min/max/p95 = total response time over N runs; ok = successful/total requests.
cold = best-effort TTFB estimate of the first request (see Limitations).

Results saved to results/host-bench-2026-09-02T18-04-43-531Z.json
```

**4. Track it over time.** Every `run` saves a JSON file; `compare` reads them:

```bash
host-bench compare
```

```
host-bench compare — 3 run(s) from results/ (oldest → newest)
site        metric  runs  first avg  latest avg  change           best min
----------  ------  ----  ---------  ----------  ---------------  --------
provider-a  api     2     32         28          -4 ms (-13%)     23
provider-a  cold    2     670        51          -620 ms (-92%)   -
provider-a  db      2     106        101         -5 ms (-5%)      96
provider-a  page    2     31         26          -5 ms (-16%)     23
snake       cold    1     197        197         +0 ms (+0%)      -
snake       page    1     62         62          +0 ms (+0%)      34
```

## Usage

```bash
host-bench init [options]

  -o, --out <path>      where to write the config (default: host-bench.config.json)
  -f, --force           overwrite the config if it already exists

host-bench run [options]

  -u, --url <url>       benchmark a single URL one-off, no config file needed
  --name <label>        label for --url mode (defaults to the hostname)
  -c, --config <path>   path to the config file (default: host-bench.config.json)
  -n, --runs <count>    requests per endpoint (default: 5)
  -t, --timeout <ms>    per-request timeout in ms (default: 10000)
  -o, --out <dir>       directory for result JSON files (default: results)
  --json                print results as JSON to stdout instead of a table
  --no-save             print the table but don't write a results file

host-bench compare [options]

  -d, --dir <path>      results directory to read (default: results)
  -l, --last <count>    only compare the N most recent runs (default: 5)
```

Notes:

- With `--url`, the path and query string are benchmarked as the page route (e.g. `--url https://api.example.com/items` times `/items`) and the result is labeled by hostname (override with `--name`).
- `--json` emits a single JSON document on stdout (the same shape as the saved file) and moves the "saved to" note to stderr, so it's safe to pipe into `jq` or a script.
- Running without a config in the directory prints a hint pointing at `init` / `--url`.

## What it measures

For every configured site:

| Metric | What it does |
| --- | --- |
| **cold** | Time to first byte (TTFB) of the very first request to the page route — a best-effort cold-start estimate. |
| **page** | N requests to your main page route; reports avg / min / max / p95 response time. |
| **api** | Same, against a configured API endpoint (e.g. `/api/health`). |
| **db** | Same, against a configured DB-backed endpoint (e.g. `/api/items`). Optional per site. |
| **anything else** | Any number of custom named endpoints — see the config docs. |

Endpoints aren't limited to GET: each one can send a custom method, headers, and a JSON body, so you can benchmark protected or write routes (with a caveat — see the security note below).

## Config file

`host-bench` reads `host-bench.config.json` from the current directory (or pass `--config <path>`):

```json
{
  "runs": 5,
  "timeoutMs": 10000,
  "sites": [
    {
      "name": "vercel",
      "baseUrl": "https://my-app.vercel.app",
      "endpoints": {
        "page": "/",
        "api": "/api/health"
      }
    },
    {
      "name": "railway",
      "baseUrl": "https://my-app-production.up.railway.app",
      "headers": { "authorization": "Bearer <token>" },
      "endpoints": {
        "page": "/",
        "api": "/api/health",
        "db": "/api/items",
        "contact": {
          "path": "/api/contact",
          "method": "POST",
          "headers": { "x-api-key": "<key>" },
          "body": { "name": "host-bench", "message": "health check" }
        }
      }
    },
    {
      "name": "render",
      "baseUrl": "https://my-app.onrender.com",
      "endpoints": { "page": "/" }
    }
  ]
}
```

### Top-level keys

| Key | Default | Meaning |
| --- | --- | --- |
| `runs` | `5` | How many times each endpoint is requested. |
| `timeoutMs` | `10000` | Per-request timeout. |
| `sites` | required | One entry per deployment to benchmark. |

### Per-site keys

| Key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Label shown in the table and JSON. |
| `baseUrl` | yes | Root URL (`http://` or `https://`); trailing slashes are trimmed. |
| `headers` | no | Headers sent with **every** request to this site (e.g. an auth token). |
| `endpoints` | no | Object of named endpoints; `page` defaults to `/` when omitted. |

### Endpoints

An endpoint value is either:

- **a path string** (GET request): `"api": "/api/health"`, or
- **an object with request options**: `{ "path": "/api/contact", "method": "POST", "headers": {...}, "body": {...} }`
  - `method` — any HTTP verb, defaults to `GET`
  - `headers` — merged over the site-level headers
  - `body` — a JSON value (stringified automatically, with `content-type: application/json` applied unless you set your own) or a pre-encoded string

**Any number of endpoints with any names is allowed** — each key becomes its own row in the table and its own series in the JSON.

> **Security note:** the config file can carry auth tokens, so don't commit real ones. Keep secrets in a local-only file (e.g. `host-bench.local.json` passed via `--config`) or inject them some other way.

## Tracking results over time

Each `run` writes `results/host-bench-<timestamp>.json` containing the tool version, timestamp, the config used, the run settings, and per-endpoint series: `avgMs`, `minMs`, `maxMs`, `p95Ms`, `avgTtfbMs`, success/error counts, URLs, methods, and the last error if any. One file per run, human-readable, diff-friendly.

`host-bench compare` aggregates those files: per site/metric it shows how many runs saw it, the first and latest average, the change between them (ms and %), and the best min seen. It reads both the current and the pre-0.3.0 result format, and it's the text-mode predecessor to a dashboard — the JSON files are the data layer a dashboard would use.

## How it works

- **TTFB vs total** — every request records two timings: TTFB (request sent → response headers arrive) and total (→ body fully drained). The table and the `avgMs`/`minMs`/`maxMs`/`p95Ms` fields are **total** response times; `avgTtfbMs` is stored alongside.
- **Cold start** — the very first request of a run is measured separately as the cold probe. Providers don't expose "is my instance asleep?" over HTTP, so this is a *best-effort estimate*: if the host never spun your app down, it's just a warm request. The probe doubles as warm-up, so the endpoint series always measure warm performance. For a realistic cold-start reading, wait out your platform's idle timeout (often 10–15 min) first.
- **p95** — computed with the nearest-rank method on the N total-time samples (with 5 runs, p95 ≈ the max; with 20 runs it's the 19th fastest).
- **Sequential, not concurrent** — endpoints are hit one request at a time to keep load light on the target. This measures latency, not capacity — it is not a load test.
- **Client-side timing** — all numbers include your network. Compare hosts only from the same machine/network, and treat localhost numbers as a no-network baseline for your app itself, not a comparison point.

## Limitations

- **Cold start is a best-effort estimate** (see above) — you may just be measuring a warm first request.
- **Numbers are client-side** — DNS, TLS, and your connection are in every measurement.
- **No per-request DNS/TLS breakdown** — connection costs are absorbed by the warm-up and connection reuse, not attributed.
- **Not a load test** — sequential requests only.

## Development

```bash
npm install
npm run lint     # syntax-check every source file
npm test         # unit + integration tests (node:test, zero test-framework deps)
npm run smoke    # end-to-end: real CLI against a throwaway local server
```

CI (`.github/workflows/ci.yml`) runs all three on every push and PR across Node 18/20/22/24. Tagging a commit `v*` triggers `.github/workflows/release.yml`, which re-tests and publishes to npm (requires an `NPM_TOKEN` repo secret) and creates the GitHub release. Dependabot (`.github/dependabot.yml`) keeps dependencies and Actions fresh weekly.

Release flow: bump `version` in `package.json` → commit → `git tag vX.Y.Z && git push --tags`.

## Project layout

```
bin/host-bench.js     CLI entry point (commander)
src/config.js         config loading + validation, --url config synthesis
src/init.js           `init` command (config scaffolding)
src/benchmark.js      HTTP timing logic (method/headers/body, cold probe, series)
src/stats.js          mean / nearest-rank percentile helpers
src/report.js         table rendering + timestamped JSON output
src/compare.js        `compare` command (trend across saved runs)
src/run.js            `run` command wiring
scripts/smoke.mjs     end-to-end smoke test used by CI
tests/                unit + integration tests (node:test)
host-bench.config.json
results/              timestamped run output (gitignored)
```

## Roadmap

- [ ] Dashboard / trend charts over stored results (the `compare` command + JSON files are the data layer)
