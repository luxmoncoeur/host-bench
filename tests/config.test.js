import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, configFromUrl } from "../src/config.js";

async function withConfig(content, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "hb-config-test-"));
  const file = path.join(dir, "host-bench.config.json");
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content), "utf8");
  try {
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("minimal config gets defaults and a default page endpoint", async () => {
  await withConfig({ sites: [{ name: "x", baseUrl: "https://x.example" }] }, async (file) => {
    const config = await loadConfig(file);
    assert.equal(config.runs, 5);
    assert.equal(config.timeoutMs, 10000);
    assert.deepEqual(config.sites[0].endpoints.page, { path: "/", method: "GET", headers: {}, body: null });
  });
});

test("endpoints accept strings, extra named keys, and request-option objects", async () => {
  await withConfig(
    {
      runs: 3,
      timeoutMs: 2000,
      sites: [
        {
          name: "x",
          baseUrl: "https://x.example/",
          endpoints: {
            page: "/",
            health: "/api/health",
            contact: {
              path: "/api/contact",
              method: "post",
              headers: { "x-token": "abc" },
              body: { hello: "world" },
            },
          },
        },
      ],
    },
    async (file) => {
      const config = await loadConfig(file);
      assert.equal(config.sites[0].baseUrl, "https://x.example"); // trailing slash trimmed
      assert.equal(config.sites[0].endpoints.health.path, "/api/health");
      const contact = config.sites[0].endpoints.contact;
      assert.equal(contact.method, "POST"); // uppercased
      assert.deepEqual(contact.headers, { "x-token": "abc" });
      assert.equal(contact.body, '{"hello":"world"}'); // object bodies are stringified
    }
  );
});

test("CLI overrides win over config values", async () => {
  await withConfig({ runs: 9, sites: [{ name: "x", baseUrl: "https://x.example" }] }, async (file) => {
    const config = await loadConfig(file, { runs: 2, timeoutMs: 1500 });
    assert.equal(config.runs, 2);
    assert.equal(config.timeoutMs, 1500);
  });
});

test("invalid configs are rejected with useful messages", async () => {
  const cases = [
    ["{oops", /not valid JSON/],
    [{ sites: [] }, /non-empty "sites"/],
    [{ sites: [{ baseUrl: "https://x.example" }] }, /needs a "name"/],
    [{ sites: [{ name: "x", baseUrl: "ftp://x.example" }] }, /http:\/\/ or https:\/\//],
    [
      { sites: [{ name: "x", baseUrl: "https://x.example", endpoints: { page: "nope" } }] },
      /path starting with "/,
    ],
    [
      {
        sites: [
          { name: "x", baseUrl: "https://x.example", endpoints: { weird: { method: "GET" } } },
        ],
      },
      /must be a path starting with "/,
    ],
    [
      {
        sites: [
          { name: "x", baseUrl: "https://x.example", endpoints: { page: { path: "/", method: "FETCH IT" } } },
        ],
      },
      /HTTP verb/,
    ],
    [
      { sites: [{ name: "x", baseUrl: "https://x.example", headers: { token: 5 } }] },
      /must be a string/,
    ],
    [{ runs: 0, sites: [{ name: "x", baseUrl: "https://x.example" }] }, /"runs"/],
  ];
  for (const [content, expected] of cases) {
    await withConfig(content, async (file) => {
      await assert.rejects(() => loadConfig(file), expected);
    });
  }
});

test("missing config file points at init / --url", async () => {
  await assert.rejects(
    () => loadConfig("/tmp/definitely-missing-config.json"),
    /host-bench init/
  );
});

test("configFromUrl builds a single-site config", () => {
  const config = configFromUrl("https://my-site.vercel.app/api/health?deep=1", { runs: 7 });
  assert.equal(config.runs, 7);
  assert.equal(config.timeoutMs, 10000);
  assert.equal(config.sites.length, 1);
  assert.equal(config.sites[0].name, "my-site.vercel.app");
  assert.equal(config.sites[0].baseUrl, "https://my-site.vercel.app");
  assert.equal(config.sites[0].endpoints.page.path, "/api/health?deep=1");
});

test("configFromUrl honors a --name override and rejects bad URLs", () => {
  const config = configFromUrl("http://localhost:3000", { name: "local" });
  assert.equal(config.sites[0].name, "local");
  assert.equal(config.sites[0].endpoints.page.path, "/");

  assert.throws(() => configFromUrl("example.com"), /valid URL/);
  assert.throws(() => configFromUrl("ftp://example.com"), /http:\/\/ or https:\/\//);
});
