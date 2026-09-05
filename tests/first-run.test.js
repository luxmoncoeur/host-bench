import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverLocalServers, configFromDiscovered } from "../src/local.js";
import { buildInteractiveConfig } from "../src/init.js";
import { checkNodeVersion, checkConfigFile, checkResultsDir } from "../src/doctor.js";

test("discoverLocalServers finds a listening port and skips dead ones", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end("nope");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const port = server.address().port;
    const found = await discoverLocalServers([port, 1, 2], 300); // ports 1 and 2 are reserved, nothing listens
    assert.equal(found.length, 1);
    assert.equal(found[0].port, port);
    assert.equal(found[0].status, 404); // any HTTP answer counts as "a server is here"
  } finally {
    server.close();
  }
});

test("configFromDiscovered builds one site per port", () => {
  const config = configFromDiscovered([{ port: 3000 }, { port: 5173 }], { runs: 3 });
  assert.equal(config.runs, 3);
  assert.deepEqual(
    config.sites.map((s) => s.name),
    ["localhost:3000", "localhost:5173"]
  );
  assert.equal(config.sites[0].endpoints.page.path, "/");
});

test("buildInteractiveConfig applies defaults", () => {
  const config = buildInteractiveConfig({ baseUrl: "http://localhost:3000/", runs: "" });
  assert.equal(config.sites[0].name, "localhost:3000"); // label defaults to the host
  assert.equal(config.sites[0].baseUrl, "http://localhost:3000"); // trailing slash trimmed
  assert.deepEqual(config.sites[0].endpoints, { page: "/" }); // api/db skipped when blank
  assert.equal(config.runs, 5);
});

test("buildInteractiveConfig keeps provided routes and validates input", () => {
  const config = buildInteractiveConfig({
    baseUrl: "https://x.example",
    name: "my-app",
    api: "/api/health",
    db: "/api/items",
  });
  assert.equal(config.sites[0].name, "my-app");
  assert.deepEqual(config.sites[0].endpoints, { page: "/", api: "/api/health", db: "/api/items" });

  assert.throws(() => buildInteractiveConfig({ baseUrl: "localhost:3000" }), /http:\/\/ or https:\/\//);
  assert.throws(() => buildInteractiveConfig({ baseUrl: "http://x.example", runs: "lots" }), /positive integer/);
  assert.throws(
    () => buildInteractiveConfig({ baseUrl: "http://x.example", api: "api/health" }),
    /must start with "/
  );
});

test("doctor: node version check", () => {
  assert.equal(checkNodeVersion("v24.7.0").ok, true);
  assert.equal(checkNodeVersion("v18.0.0").ok, true);
  assert.equal(checkNodeVersion("v16.20.0").ok, false);
});

test("doctor: config file check — valid, missing, and broken", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-doctor-"));
  try {
    const good = path.join(dir, "good.json");
    await writeFile(good, JSON.stringify({ sites: [{ name: "x", baseUrl: "https://x.example" }] }));
    assert.equal((await checkConfigFile(good)).ok, true);

    // a missing config is a notice, not a failure — one-off mode needs none
    assert.equal((await checkConfigFile(path.join(dir, "missing.json"))).ok, null);

    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{oops");
    const badCheck = await checkConfigFile(bad);
    assert.equal(badCheck.ok, false);
    assert.match(badCheck.detail, /not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("doctor: results directory check", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-doctor-"));
  try {
    const results = await checkResultsDir(path.join(dir, "results"));
    assert.equal(results.ok, true);
    // a second check on the now-existing dir also passes
    assert.equal((await checkResultsDir(path.join(dir, "results"))).ok, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
