import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

// A config that works out of the box: example.com is always reachable, so a
// first `host-bench run` right after `init` succeeds before the user has a
// site of their own to point at.
const DEMO_CONFIG = {
  runs: 5,
  timeoutMs: 10000,
  sites: [
    {
      name: "example",
      baseUrl: "https://example.com",
      endpoints: { page: "/" },
    },
  ],
};

export async function initCommand(opts) {
  const config = opts.interactive ? await askConfig() : DEMO_CONFIG;
  await writeConfig(opts, config);
}

async function writeConfig(opts, config) {
  const target = path.resolve(process.cwd(), opts.out);

  if (!opts.force) {
    try {
      await access(target);
      throw new Error(`"${target}" already exists — use --force to overwrite it.`);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  await writeFile(target, JSON.stringify(config, null, 2) + "\n", "utf8");

  console.log(`Created ${target}`);
  console.log(`
Next steps:
  1. host-bench run
     Benchmarks ${config.sites[0].baseUrl} so you can see it work.
  2. When your site is deployed, edit "baseUrl" in the config — and add
     "api" / "db" endpoints if you have routes worth timing.

Or benchmark any URL one-off, no config file needed:
  host-bench run --url https://your-site.example`);
}

async function askConfig() {
  // Interactive on a real terminal; deterministic line parsing when stdin is
  // piped (readline's question() races against EOF on non-TTY input).
  if (process.stdin.isTTY) {
    return askConfigInteractive();
  }
  return buildInteractiveConfig(await readPipedAnswers());
}

async function readPipedAnswers() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const [baseUrl, name, page, api, db, runs] = chunks
    .join("")
    .split(/\r?\n/)
    .map((line) => line.trim());
  return { baseUrl, name, page, api, db, runs };
}

async function askConfigInteractive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("Answer a few questions (press Enter to accept the default):\n");
    const baseUrl = (await rl.question("Site URL to benchmark (e.g. http://localhost:3000): ")).trim();
    const host = safeHost(baseUrl);
    const name = (await rl.question(`Label for this site (${host}): `)).trim();
    const page = (await rl.question("Page path (/): ")).trim();
    const api = (await rl.question("API route to test (blank to skip): ")).trim();
    const db = (await rl.question("DB-backed route to test (blank to skip): ")).trim();
    const runs = (await rl.question("Requests per endpoint (5): ")).trim();
    return buildInteractiveConfig({ baseUrl, name, page, api, db, runs });
  } finally {
    rl.close();
  }
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "site";
  }
}

// Pure so tests can exercise it without a terminal. Blank answers ("" from
// the prompts) fall back to the same defaults shown in the questions.
export function buildInteractiveConfig(answers) {
  const { baseUrl, name = "", page = "", api = "", db = "", runs = "" } = answers;
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    throw new Error(`The URL must start with http:// or https:// (got "${baseUrl}").`);
  }
  const runsRaw = runs === "" ? "5" : runs;
  const runsNum = Number.parseInt(runsRaw, 10);
  if (!Number.isInteger(runsNum) || runsNum < 1) {
    throw new Error(`Requests per endpoint must be a positive integer (got "${runsRaw}").`);
  }

  const pagePath = page === "" ? "/" : page;
  const endpoints = {};
  const routes = [["page", pagePath], ...(api ? [["api", api]] : []), ...(db ? [["db", db]] : [])];
  for (const [key, value] of routes) {
    if (typeof value !== "string" || !value.startsWith("/")) {
      throw new Error(`Endpoint paths must start with "/" (got ${JSON.stringify(value)}).`);
    }
    endpoints[key] = value;
  }

  return {
    runs: runsNum,
    timeoutMs: 10000,
    sites: [
      {
        name: name || new URL(baseUrl).host,
        baseUrl: baseUrl.replace(/\/+$/, ""),
        endpoints,
      },
    ],
  };
}
