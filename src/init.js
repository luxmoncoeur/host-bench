import { access, writeFile } from "node:fs/promises";
import path from "node:path";

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
  const target = path.resolve(process.cwd(), opts.out);

  if (!opts.force) {
    try {
      await access(target);
      throw new Error(`"${target}" already exists — use --force to overwrite it.`);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  await writeFile(target, JSON.stringify(DEMO_CONFIG, null, 2) + "\n", "utf8");

  console.log(`Created ${target}`);
  console.log(`
Next steps:
  1. host-bench run
     Benchmarks the demo entry (https://example.com) so you can see it work.
  2. When your site is deployed, edit "baseUrl" in the config — and add
     "api" / "db" endpoints if you have routes worth timing.

Or benchmark any URL one-off, no config file needed:
  host-bench run --url https://your-site.example`);
}
