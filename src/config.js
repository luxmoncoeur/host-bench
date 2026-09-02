import { readFile } from "node:fs/promises";

const DEFAULTS = { runs: 5, timeoutMs: 10_000 };

export async function loadConfig(configPath, overrides = {}) {
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new Error(
      `Could not read config file "${configPath}". Run \`host-bench init\` to create one, or use \`host-bench run --url <url>\` for a quick one-off.`
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config file "${configPath}" is not valid JSON: ${err.message}`);
  }

  const config = normalize(parsed, configPath);

  if (overrides.runs != null) config.runs = overrides.runs;
  if (overrides.timeoutMs != null) {
    if (overrides.timeoutMs < 100) {
      throw new Error("--timeout must be at least 100 ms.");
    }
    config.timeoutMs = overrides.timeoutMs;
  }
  return config;
}

function normalize(raw, configPath) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Config file "${configPath}" must contain a JSON object.`);
  }
  if (!Array.isArray(raw.sites) || raw.sites.length === 0) {
    throw new Error(`Config file "${configPath}" needs a non-empty "sites" array.`);
  }
  return {
    runs: validateInt(raw.runs ?? DEFAULTS.runs, "runs", 1, configPath),
    timeoutMs: validateInt(raw.timeoutMs ?? DEFAULTS.timeoutMs, "timeoutMs", 100, configPath),
    sites: raw.sites.map(validateSite),
  };
}

function validateInt(value, field, min, configPath) {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(
      `Config field "${field}" in "${configPath}" must be an integer >= ${min} (got ${JSON.stringify(value)}).`
    );
  }
  return value;
}

function validateSite(site, index) {
  const where = `sites[${index}]`;
  if (typeof site !== "object" || site === null) {
    throw new Error(`Config ${where} must be an object.`);
  }
  if (typeof site.name !== "string" || site.name.trim() === "") {
    throw new Error(`Config ${where} needs a "name" string.`);
  }
  if (typeof site.baseUrl !== "string" || !/^https?:\/\//.test(site.baseUrl)) {
    throw new Error(`Config ${where} needs a "baseUrl" starting with http:// or https://.`);
  }

  const endpoints = site.endpoints ?? {};
  if (typeof endpoints !== "object" || Array.isArray(endpoints)) {
    throw new Error(`Config ${where}.endpoints must be an object.`);
  }

  const clean = {};
  for (const key of ["page", "api", "db"]) {
    const value = endpoints[key];
    if (value == null) {
      clean[key] = key === "page" ? "/" : null; // page defaults to "/"; api/db are optional
      continue;
    }
    if (typeof value !== "string" || !value.startsWith("/")) {
      throw new Error(
        `Config ${where}.endpoints.${key} must be a path starting with "/" (got ${JSON.stringify(value)}).`
      );
    }
    clean[key] = value;
  }

  return { name: site.name, baseUrl: site.baseUrl.replace(/\/+$/, ""), endpoints: clean };
}
