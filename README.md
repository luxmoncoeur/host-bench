# host-bench

[![CI](https://github.com/luxmoncoeur/host-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/luxmoncoeur/host-bench/actions/workflows/ci.yml)

A small CLI tool for testing **website and API performance**.

`host-bench` sends real HTTP requests to your application, measures how long they take, saves the results, and lets you compare them over time.

It can be used to test a local app, staging or production deployment, or compare the same app across hosting providers such as **Vercel, Railway, Render, and Fly.io**.

Requires **Node.js 18+**.

---

## Demo

Test any URL without a config file:

```bash
npx host-bench run --url https://your-site.vercel.app
```

Or use the full config-based flow:

```bash
host-bench init
host-bench run
host-bench compare
```

Example output:

```text
host-bench v0.3.0 — 1 site(s), 5 run(s) per endpoint

snake  https://slitherin-game.vercel.app
  page / — avg 62 ms · min 34 · max 169 · p95 169 · 5/5 ok

results
site   metric  endpoint  avg ms  min ms  max ms  p95 ms  ok
-----  ------  --------  ------  ------  ------  ------  ---
snake  page    /         62      34      169     169     5/5

Results saved to results/host-bench-2026-09-02T18-04-43-531Z.json
```

Every run can be saved and compared later.

**The basic idea: measure → save → compare.**

---

## Install

```bash
# global install from npm (once published)
npm install -g host-bench

# or run it directly without installing
npx host-bench run

# or, from a clone of this repo
npm link
```

## Quickstart

**1. Create a config.**

```bash
host-bench init
```

This creates `host-bench.config.json` with an example site.

**2. Add your sites and endpoints.**

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
      "baseUrl": "https://my-app.up.railway.app",
      "endpoints": {
        "page": "/"
      }
    }
  ]
}
```

**3. Run it.**

```bash
host-bench run
```

**4. Compare previous runs.**

```bash
host-bench compare
```

You can also view the latest saved result:

```bash
host-bench show
```

---

## Usage

```bash
host-bench init [options]

  -o, --out <path>      where to write the config (default: host-bench.config.json)
  -f, --force           overwrite the config if it already exists

host-bench run [options]

  -u, --url <url>       benchmark a single URL without a config file
  --name <label>        label for --url mode (defaults to the hostname)
  -c, --config <path>   path to the config file
  -n, --runs <count>    requests per endpoint (default: 5)
  -t, --timeout <ms>    per-request timeout (default: 10000)
  --warmup <count>      extra unmeasured requests per endpoint
  --delay <ms>          delay between requests
  --fail-over <ms>      fail if an endpoint's average exceeds this value
  -o, --out <dir>       directory for result JSON files
  --json                print results as JSON
  --no-save             print results without saving a file

host-bench compare [options]

  -d, --dir <path>      results directory
  -l, --last <count>    number of recent runs to compare
  -f, --format <type>   output format: table or markdown

host-bench show [file] [options]

  [file]                result file name, or "latest"
  -d, --dir <path>      results directory
```

With `--url`, you can quickly test one URL without creating a config:

```bash
host-bench run --url https://api.example.com/items
```

`--json` outputs the results as JSON, making them easy to use with other tools.

---

## What it measures

For each configured endpoint, `host-bench` records response timing and request results.

| Metric               | What it does                          |
| -------------------- | ------------------------------------- |
| **cold**             | Measures the first request separately |
| **page**             | Tests the main page                   |
| **api**              | Tests a configured API endpoint       |
| **db**               | Tests a DB-backed endpoint            |
| **custom endpoints** | Test any other endpoint you configure |

Each endpoint can use a custom HTTP method, headers, and JSON body, so you can also test protected or write routes.

---

## Config file

`host-bench` reads `host-bench.config.json` by default.

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
      "headers": {
        "authorization": "Bearer <token>"
      },
      "endpoints": {
        "page": "/",
        "api": "/api/health",
        "db": "/api/items",
        "contact": {
          "path": "/api/contact",
          "method": "POST",
          "headers": {
            "x-api-key": "<key>"
          },
          "body": {
            "name": "host-bench",
            "message": "health check"
          }
        }
      }
    }
  ]
}
```

### Top-level keys

| Key         | Default  | Meaning                         |
| ----------- | -------- | ------------------------------- |
| `runs`      | `5`      | Number of requests per endpoint |
| `timeoutMs` | `10000`  | Request timeout                 |
| `warmup`    | `0`      | Extra requests before measuring |
| `delayMs`   | `0`      | Delay between requests          |
| `sites`     | required | Sites to benchmark              |

### Per-site keys

| Key         | Required | Meaning                         |
| ----------- | -------- | ------------------------------- |
| `name`      | yes      | Name shown in results           |
| `baseUrl`   | yes      | Website or API URL              |
| `headers`   | no       | Headers sent with every request |
| `endpoints` | no       | Endpoints to test               |

### Endpoints

An endpoint can be a simple path:

```json
"api": "/api/health"
```

or a full request configuration:

```json
"contact": {
  "path": "/api/contact",
  "method": "POST",
  "headers": {
    "x-api-key": "<key>"
  },
  "body": {
    "name": "host-bench",
    "message": "health check"
  },
  "expect": {
    "status": 200
  }
}
```

You can use any endpoint name and configure its method, headers, body, and expected status.

> **Security:** config files can contain API keys or authentication tokens. Don't commit real secrets. Use a local config file such as `host-bench.local.json` when needed.

---

## Tracking results over time

Each `run` saves a JSON result in the `results/` directory.

```bash
host-bench run
```

Example:

```text
results/
└── host-bench-2026-09-02T18-04-43-531Z.json
```

Use `compare` to see how results changed:

```bash
host-bench compare
```

Example:

```text
host-bench compare — 3 run(s) from results/ (oldest → newest)

site        metric  runs  first avg  latest avg  change
----------  ------  ----  ---------  ----------  ---------------
provider-a  api     2     32         28          -4 ms (-13%)
provider-a  db      2     106        101         -5 ms (-5%)
provider-a  page    2     31         26          -5 ms (-16%)
```

The saved JSON files can also be used as the data source for future tools such as a dashboard.

`show` displays a saved result without running another benchmark:

```bash
host-bench show
host-bench show host-bench-2026-09-02T18-04-43-531Z.json
```

---

## Use in your own CI

`host-bench` can act as a simple performance check.

```bash
host-bench run \
  --url https://my-site.vercel.app \
  --fail-over 300 \
  --no-save
```

If the average response time goes above the limit, the command fails.

You can also use the included GitHub Action:

```yaml
- name: Performance check
  uses: luxmoncoeur/host-bench@main
  with:
    url: https://my-site.vercel.app
    runs: 10
    fail-over: 300
```

---

## How it works

`host-bench` sends real HTTP requests to your configured endpoints and records their response times.

Each request records both TTFB and total response time. The main `avg`, `min`, `max`, `p50`, `p95`, and `p99` results use total response time.

The first request is also recorded as a `cold` measurement. This is a best-effort estimate and does not guarantee that a hosting provider actually started a sleeping instance.

Requests are sent sequentially to keep the benchmark lightweight.

All measurements are taken from the machine running `host-bench`, so your network can affect the results. For hosting comparisons, use the same machine and network.

---

## Limitations

- Cold-start measurements are best-effort.
- Results are affected by the network running the benchmark.
- Connection setup is included in the measurements.
- Requests are sequential.
- `host-bench` is a performance benchmark, **not a load-testing tool**.

---

## Development

```bash
npm install
npm run lint
npm test
npm run smoke
```

CI runs lint, unit/integration tests, and the smoke test across Node 18/20/22/24.

Tagging a commit with `v*` triggers the release workflow, which tests and publishes the package to npm.

Dependabot keeps dependencies and GitHub Actions updated weekly.

### Release

1. Update `version` in `package.json`
2. Commit the change
3. Create a tag:

```bash
git tag vX.Y.Z
git push --tags
```

---

## Project layout

```text
bin/host-bench.js     CLI entry point
src/config.js         config loading + validation
src/init.js           config scaffolding
src/benchmark.js      HTTP benchmarking
src/stats.js          statistics
src/report.js         result output
src/compare.js        result comparison
src/show.js            saved result display
src/run.js             run command + performance gate
scripts/smoke.mjs     end-to-end smoke test
tests/                unit + integration tests
action.yml            GitHub Action
host-bench.config.json
results/              timestamped results (gitignored)
```

---

## Roadmap

- [ ] Dashboard / trend charts over stored results

The existing `compare` command and saved JSON results provide the data for a future dashboard.
