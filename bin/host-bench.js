#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { createRequire } from "node:module";
import { runCommand } from "../src/run.js";
import { initCommand } from "../src/init.js";
import { compareCommand } from "../src/compare.js";
import { showCommand } from "../src/show.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

function intInRange(min) {
  return (value) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < min) {
      throw new InvalidArgumentError(`Expected an integer >= ${min}, got "${value}".`);
    }
    return n;
  };
}

const positiveInt = intInRange(1);
const nonNegativeInt = intInRange(0);

const program = new Command();

program
  .name("host-bench")
  .description(
    "Benchmark hosting providers (Vercel, Railway, Render, Fly.io) for a dynamic site's performance."
  )
  .version(pkg.version);

program
  .command("init")
  .description(
    "Create a starter host-bench.config.json in the current directory (with a working demo entry)"
  )
  .option("-o, --out <path>", "where to write the config file", "host-bench.config.json")
  .option("-f, --force", "overwrite the config file if it already exists")
  .action(initCommand);

program
  .command("run")
  .description(
    "Run every benchmark in the config file, print a results table, and save the raw numbers as JSON"
  )
  .option("-u, --url <url>", "benchmark a single URL one-off, no config file needed")
  .option("--name <label>", "label for --url mode (defaults to the hostname)")
  .option("-c, --config <path>", "path to the config file", "host-bench.config.json")
  .option("-n, --runs <count>", "number of requests per endpoint (overrides the config file)", positiveInt)
  .option("-t, --timeout <ms>", "per-request timeout in milliseconds (overrides the config file)", positiveInt)
  .option("--warmup <count>", "extra unmeasured requests per endpoint (overrides the config file)", nonNegativeInt)
  .option("--delay <ms>", "delay between requests in ms (overrides the config file)", nonNegativeInt)
  .option("--fail-over <ms>", "performance gate: exit with code 2 if any endpoint avg exceeds this", nonNegativeInt)
  .option("-o, --out <dir>", "directory to write result JSON files to", "results")
  .option("--json", "print results as JSON to stdout instead of a table")
  .option("--no-save", "print the table but do not write a results JSON file")
  .action(runCommand);

program
  .command("compare")
  .description(
    "Compare saved runs over time: first vs latest avg per site/metric, and the best min seen"
  )
  .option("-d, --dir <path>", "results directory to read", "results")
  .option("-l, --last <count>", "only compare the N most recent runs", positiveInt, 5)
  .option("-f, --format <type>", "output format: table or markdown (paste-ready)", "table")
  .action(compareCommand);

program
  .command("show")
  .description("Pretty-print a saved run from the results directory without re-benchmarking")
  .argument("[file]", "result file name, or 'latest'", "latest")
  .option("-d, --dir <path>", "results directory to read", "results")
  .action(showCommand);

program.parseAsync(process.argv).catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
