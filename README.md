# host-bench

A small CLI that benchmarks hosting providers (Vercel, Railway, Render, Fly.io) for a **dynamic site's** performance, so you can compare how the same app behaves on different hosts.

You point it at one or more deployed sites via a config file (or a single URL), it hits each site's pages/API/DB-backed routes with real HTTP requests, prints a comparison table, and saves the raw numbers as timestamped JSON so you can track how a deployment performs over time.

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

## Install

```bash
# global install
npm install -g host-bench

# …or run it directly without installing
npx host-bench run
```

Node.js 18+ is required (uses the built-in `fetch`).

## Quickstart (no site yet? start here)

```bash
npm link                      # one-time, inside the host-bench repo — gives you the global `host-bench` command
host-bench init               # writes host-bench.config.json with a working demo entry (example.com)
host-bench run                # benchmarks it — success on the very first run
```

When your site is deployed, edit `baseUrl` in the generated config — or skip the config file entirely and benchmark any URL one-off:

```bash
host-bench run --url https://your-site.vercel.app
host-bench run --url http://localhost:3000 -n 10   # local dev server, 10 runs
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

With `--url`, the path and query string are benchmarked as the page route (e.g. `--url https://api.example.com/items` times `/items`). For multiple sites or multiple endpoints, use a config file. Use `--json` in scripts — the table/progress output stays on stdout as a single JSON document, and the "saved to" note moves to stderr.

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

Top-level keys:

- `runs` — how many times to hit each endpoint (default `5`).
- `timeoutMs` — per-request timeout (default `10000`).
- `sites` — one entry per deployment to benchmark.

Per site:

- `name` — label shown in the table and JSON.
- `baseUrl` — root URL, `http://` or `https://`; trailing slashes are trimmed.
- `headers` — optional; headers sent with **every** request to this site (e.g. an auth token).
- `endpoints` — an object where **any key is a custom metric name** and the value is either:
  - a path string (GET request): `"api": "/api/health"`, or
  - an object with request options: `{ "path": "/api/contact", "method": "POST", "headers": {...}, "body": {...} }`. Bodies may be JSON values (stringified automatically, with `content-type: application/json` applied unless you set your own) or pre-encoded strings. `method` defaults to `GET`.

`page` defaults to `/` when omitted. Every endpoint key appears as its own row in the table and its own series in the JSON.

> **Security note:** the config file can carry auth tokens, so don't commit real ones. Keep secrets in a local-only file (e.g. `host-bench.local.json` passed via `--config`) or inject them some other way.

## Tracking results over time

Each `run` writes `results/host-bench-<timestamp>.json` with the full numbers — avg/min/max/p95, TTFB, per-series success counts, URLs, and the settings used. Then:

```bash
host-bench compare              # first avg → latest avg per site/metric, plus best min
host-bench compare -l 10        # look at the last 10 runs instead of 5
```

```
host-bench compare — 3 run(s) from results/ (oldest → newest)
site     metric   runs  first avg  latest avg  change          best min
-------  -------  ----  ---------  ----------  ---------------  --------
railway  api        3         39          41  +2 ms (+5%)             37
         cold       3         83          61  -22 ms (-27%)           61
         db         3         95          92  -3 ms (-3%)             90
         page       3         41          38  -3 ms (-7%)             38
```

`compare` reads both the current and the pre-0.3.0 result format. It's the text-mode predecessor to a dashboard — the JSON files it reads are the same source a dashboard would use.

## Limitations

- **Cold start is a best-effort estimate.** Providers don't expose "is my instance asleep?" via HTTP, so `cold` is simply the TTFB of the first request in a run. If the host hadn't spun your app down, this is just a warm request. For a true cold-start test, wait for your platform's idle timeout (often 10–15 min) before running. The first request also warms the app up, so the endpoint series measure warm performance.
- **Server timings only from the outside.** All numbers are client-side HTTP timings (network included). Run from the same machine/network when comparing providers, or the comparison is apples-to-oranges. Numbers from localhost measure your app with no network — a baseline, not a comparison point.
- The first request is a warm-up; DNS/TLS costs are mostly absorbed by it and by connection reuse, not broken out per request.
- Endpoints are benchmarked sequentially, which keeps load light on the target but means results aren't load tests.

## Development

```bash
npm install
npm run lint     # syntax-check every source file
npm test         # unit + integration tests (node:test, no test framework deps)
npm run smoke    # end-to-end: real CLI against a throwaway local server
```

CI runs all three on every push/PR across Node 18/20/22/24 (see `.github/workflows/ci.yml`). Tagging a commit `v*` triggers `.github/workflows/release.yml`, which re-tests and publishes to npm (requires an `NPM_TOKEN` secret). Dependabot keeps dependencies and Actions fresh.

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
