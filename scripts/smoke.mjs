// End-to-end smoke test: runs the real CLI against a throwaway local server.
// Fully offline — this is what CI runs to prove the binary isn't broken.
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const bin = fileURLToPath(new URL("../bin/host-bench.js", import.meta.url));

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, path: req.url }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

// Async spawn: unlike spawnSync, this keeps this process's event loop (and the
// test server) free to serve the child CLI's requests.
function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], { encoding: "utf8", ...opts });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const dir = await mkdtemp(path.join(tmpdir(), "hb-smoke-"));
try {
  const config = path.join(dir, "host-bench.config.json");
  await writeFile(
    config,
    JSON.stringify({
      runs: 2,
      timeoutMs: 3000,
      sites: [
        {
          name: "local",
          baseUrl: `http://127.0.0.1:${port}`,
          endpoints: {
            page: "/",
            api: "/api/health",
            ping: { path: "/api/ping", method: "POST", body: { a: 1 } },
          },
        },
      ],
    }),
    "utf8"
  );

  // 1. Table run saves a results file, renders the new columns, and succeeds.
  const table = await run(["run", "--config", config, "--out", path.join(dir, "results")]);
  assert.equal(table.status, 0, table.stderr + table.stdout);
  assert.match(table.stdout, /p95 ms/);
  assert.match(table.stdout, /POST \/api\/ping/);
  assert.match(table.stdout, /2\/2 ok/, "all requests must succeed against the local server");
  assert.match(table.stdout, /Results saved to/);

  // 2. --json mode emits a parseable payload with all series.
  const json = await run([
    "run", "--config", config, "--out", path.join(dir, "results"), "--json",
  ]);
  assert.equal(json.status, 0, json.stderr + json.stdout);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.tool, "host-bench");
  assert.equal(payload.results[0].endpoints.ping.successes, 2);
  assert.ok(payload.results[0].endpoints.api.p95Ms > 0);
  assert.ok(payload.results[0].endpoints.api.p50Ms > 0);
  assert.ok(payload.results[0].endpoints.api.avgBytes > 0);
  assert.deepEqual(payload.results[0].endpoints.page.statuses, { 200: 2 });

  // 3. Performance gate: generous budget passes, zero budget exits with code 2.
  const gatePass = await run([
    "run", "--config", config, "--out", path.join(dir, "results"), "--fail-over", "10000", "--no-save",
  ]);
  assert.equal(gatePass.status, 0, gatePass.stderr + gatePass.stdout);
  assert.match(gatePass.stdout, /Performance gate passed/);

  const gateFail = await run([
    "run", "--config", config, "--out", path.join(dir, "results"), "--fail-over", "0", "--no-save",
  ]);
  assert.equal(gateFail.status, 2, gateFail.stderr + gateFail.stdout);
  assert.match(gateFail.stdout, /Performance gate FAILED/);
  assert.match(gateFail.stdout, /ms budget/);

  // 4. compare reads the runs it just saved, in table and markdown form.
  const compare = await run(["compare", "--dir", path.join(dir, "results")]);
  assert.equal(compare.status, 0, compare.stderr + compare.stdout);
  assert.match(compare.stdout, /first avg/);

  const compareMd = await run([
    "compare", "--dir", path.join(dir, "results"), "--format", "markdown",
  ]);
  assert.equal(compareMd.status, 0, compareMd.stderr + compareMd.stdout);
  assert.match(compareMd.stdout, /\| site \| metric \| runs \|/);
  assert.match(compareMd.stdout, /\| --- /);

  // 5. show pretty-prints the latest saved run without re-benchmarking.
  const show = await run(["show", "latest", "--dir", path.join(dir, "results")]);
  assert.equal(show.status, 0, show.stderr + show.stdout);
  assert.match(show.stdout, /host-bench v\d/);
  assert.match(show.stdout, /results/);

  // 6. init scaffolds a usable config in an empty directory.
  const initDir = path.join(dir, "initcheck");
  await mkdir(initDir);
  const init = await run(["init"], { cwd: initDir });
  assert.equal(init.status, 0, init.stderr + init.stdout);
  const scaffold = JSON.parse(await readFile(path.join(initDir, "host-bench.config.json"), "utf8"));
  assert.equal(scaffold.sites.length, 1);
  assert.ok(scaffold.sites[0].baseUrl.startsWith("https://"));

  console.log("smoke OK: run table, run --json, gate pass/fail, compare (table+markdown), show, init");
} finally {
  server.close();
  await rm(dir, { recursive: true, force: true });
}
