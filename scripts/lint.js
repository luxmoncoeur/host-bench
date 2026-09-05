// Cross-platform syntax check. Replaces a Unix-shell glob loop so that
// `npm run lint` works the same on Windows, macOS, and Linux.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dirs = ["bin", "src", "tests", "scripts"];

let failures = 0;
let checked = 0;

for (const dir of dirs) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(js|mjs)$/.test(entry.name)) continue;
    const file = path.join(root, dir, entry.name);
    checked++;
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status === 0) {
      console.log(`ok    ${path.relative(root, file)}`);
    } else {
      failures++;
      console.error(`FAIL  ${path.relative(root, file)}`);
      console.error(result.stderr);
    }
  }
}

console.log(`\n${checked} file(s) checked, ${failures} failure(s)`);
process.exitCode = failures > 0 ? 1 : 0;
