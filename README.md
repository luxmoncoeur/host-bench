# host-bench

A small CLI that benchmarks hosting providers (Vercel, Railway, Render, Fly.io) for a **dynamic site's** performance, so you can compare how the same app behaves on different hosts.

You point it at one or more deployed sites via a config file, it hits each site's pages/API/DB-backed routes with real HTTP requests, and it prints a comparison table plus saves the raw numbers as timestamped JSON for tracking over time.

## What it measures

For every configured site:

| Metric | What it does |
| --- | --- |
| **cold** | Time to first byte (TTFB) of the very first request to the page route — a best-effort cold-start estimate. |
| **page** | N GETs to your main page route; reports avg / min / max total response time. |
| **api** | Same, against a configured API endpoint (e.g. `/api/health`). |
| **db** | Same, against a configured DB-backed endpoint (e.g. `/api/items`). **Optional per site** — omit it and it's skipped. |

`api` and `db` are optional; `page` defaults to `/` if you don't specify it.

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

Options:
  -u, --url <url>       benchmark a single URL one-off, no config file needed
  -c, --config <path>   path to the config file (default: host-bench.config.json)
  -n, --runs <count>    requests per endpoint; overrides the config file
  -t, --timeout <ms>    per-request timeout in ms (default: 10000)
  -o, --out <dir>       directory for result JSON files (default: results)
  --no-save             print the table but don't write a results file
  -V, --version         show version
```

With `--url`, the path and query string are benchmarked as the page route (e.g. `--url https://api.example.com/items` times `/items`) and results are labeled by hostname. For multiple sites or API/DB endpoints, use a config file.

## Config file

`host-bench` reads `host-bench.config.json` from the current directory (or pass `--config <path>`).

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
      "endpoints": {
        "page": "/",
        "api": "/api/health",
        "db": "/api/items"
      }
    },
    {
      "name": "render",
      "baseUrl": "https://my-app.onrender.com",
      "endpoints": {
        "page": "/"
      }
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
- `endpoints.page` — main page path (defaults to `/`).
- `endpoints.api` — API route path, or omit to skip.
- `endpoints.db` — DB-backed route path, or omit to skip. Handy if you haven't built the DB route yet on one provider.

## Results

The `run` command prints a table like:

```
results
site    metric  endpoint      avg ms  min ms  max ms  ok
------  ------  ------------  ------  ------  ------  ------
railway cold    /                 83      -       -  1/1
        page    /                 41      38      52  5/5
        api     /api/health       39      37      44  5/5
        db      /api/items        95      90     120  5/5
render  cold    /                612      -       -  1/1
        page    /                 55      50      70  5/5
        api     (not configured)  skipped
```

Each run is also written to `results/host-bench-<timestamp>.json` (one file per run) with the full numbers — avg/min/max, per-series success counts, URLs, and the settings used — so you can diff runs over time.

## Limitations

- **Cold start is a best-effort estimate.** Providers don't expose "is my instance asleep?" via HTTP, so `cold` is simply the TTFB of the first request in a run. If the host hadn't spun your app down, this is just a warm request. For a true cold-start test, wait for your platform's idle timeout (often 10–15 min) before running. The first request also warms the app up, so the `page`/`api`/`db` series measure warm performance.
- **Server timings only from the outside.** All numbers are client-side HTTP timings (network included). Run from the same machine/network when comparing providers, or the comparison is apples-to-oranges.
- The first request is a warm-up; DNS/TLS costs are mostly absorbed by it and by connection reuse, not broken out per request.

## Project layout

```
bin/host-bench.js     CLI entry point (commander)
src/config.js         config loading + validation
src/init.js           `init` command (config scaffolding)
src/benchmark.js      HTTP timing logic
src/report.js         table rendering + JSON output
src/run.js            `run` command wiring
host-bench.config.json
results/              timestamped run output
```

## Roadmap

- [ ] Dashboard / trend charts over stored results
