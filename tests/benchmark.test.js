import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { benchmarkSite } from "../src/benchmark.js";

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("measures a plain GET page end to end", async () => {
  const { server, port } = await startServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>ok</html>");
    }, 5);
  });

  try {
    const site = {
      name: "local",
      baseUrl: `http://127.0.0.1:${port}`,
      headers: {},
      endpoints: { page: { path: "/", method: "GET", headers: {}, body: null } },
    };
    const result = await benchmarkSite(site, { runs: 3, timeoutMs: 2000 }, () => {});

    assert.equal(result.name, "local");
    assert.ok(result.coldStart, "cold-start probe should exist");
    assert.ok(result.coldStart.ttfbMs > 0);

    const series = result.endpoints.page;
    assert.equal(series.requests, 3);
    assert.equal(series.successes, 3);
    assert.equal(series.errors, 0);
    assert.ok(series.avgMs > 0);
    assert.ok(series.minMs <= series.p95Ms && series.p95Ms <= series.maxMs);
    assert.ok(series.avgTtfbMs > 0);
    assert.equal(series.lastError, null);
  } finally {
    server.close();
  }
});

test("custom named endpoints send method, headers and body", async () => {
  const seen = {};
  const { server, port } = await startServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen[req.url] = {
        method: req.method,
        headers: req.headers,
        body,
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    const site = {
      name: "local",
      baseUrl: `http://127.0.0.1:${port}`,
      headers: { "x-shared": "site-level" },
      endpoints: {
        page: { path: "/", method: "GET", headers: {}, body: null },
        contact: {
          path: "/api/contact",
          method: "POST",
          headers: { "x-token": "secret" },
          body: { hello: "world" },
        },
      },
    };
    const result = await benchmarkSite(site, { runs: 2, timeoutMs: 2000 }, () => {});

    assert.ok(result.endpoints.contact, "custom endpoint should be benchmarked");
    assert.equal(result.endpoints.contact.successes, 2);

    const req = seen["/api/contact"];
    assert.equal(req.method, "POST");
    assert.equal(req.headers["x-token"], "secret");
    assert.equal(req.headers["x-shared"], "site-level"); // site headers are merged in
    assert.equal(req.headers["content-type"], "application/json"); // applied by default
    assert.equal(req.body, '{"hello":"world"}');
  } finally {
    server.close();
  }
});

test("failing endpoints are counted, not thrown", async () => {
  const { server, port } = await startServer((req, res) => {
    res.writeHead(500);
    res.end("boom");
  });

  try {
    const site = {
      name: "local",
      baseUrl: `http://127.0.0.1:${port}`,
      headers: {},
      endpoints: { page: { path: "/", method: "GET", headers: {}, body: null } },
    };
    const result = await benchmarkSite(site, { runs: 3, timeoutMs: 2000 }, () => {});

    const series = result.endpoints.page;
    assert.equal(series.successes, 0);
    assert.equal(series.errors, 3);
    assert.match(series.lastError, /500/);
    assert.equal(series.avgMs, null);
    assert.match(result.coldStart.error, /500/);
  } finally {
    server.close();
  }
});
