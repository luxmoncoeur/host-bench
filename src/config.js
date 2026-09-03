import { readFile } from "node:fs/promises";

const DEFAULTS = { runs: 5, timeoutMs: 10_000, warmup: 0, delayMs: 0 };
const HTTP_METHOD_RE = /^[A-Za-z]+$/;

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
  if (overrides.warmup != null) config.warmup = overrides.warmup;
  if (overrides.delayMs != null) config.delayMs = overrides.delayMs;
  return config;
}

// Ad-hoc single-URL mode: `host-bench run --url https://my-site.example/api/health`
export function configFromUrl(url, opts = {}) {
  if (opts.timeoutMs != null && opts.timeoutMs < 100) {
    throw new Error("--timeout must be at least 100 ms.");
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`--url must be a valid URL (got "${url}").`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`--url must start with http:// or https:// (got "${url}").`);
  }

  const page = u.pathname + u.search;
  return {
    runs: opts.runs ?? DEFAULTS.runs,
    timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs,
    warmup: opts.warmup ?? DEFAULTS.warmup,
    delayMs: opts.delayMs ?? DEFAULTS.delayMs,
    sites: [
      {
        name: opts.name || u.host,
        baseUrl: u.origin,
        headers: {},
        endpoints: {
          page: { path: page === "" ? "/" : page, method: "GET", headers: {}, body: null, expect: null },
        },
      },
    ],
  };
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
    warmup: validateInt(raw.warmup ?? DEFAULTS.warmup, "warmup", 0, configPath),
    delayMs: validateInt(raw.delayMs ?? DEFAULTS.delayMs, "delayMs", 0, configPath),
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
  if (typeof site !== "object" || site === null || Array.isArray(site)) {
    throw new Error(`Config ${where} must be an object.`);
  }
  if (typeof site.name !== "string" || site.name.trim() === "") {
    throw new Error(`Config ${where} needs a "name" string.`);
  }
  if (typeof site.baseUrl !== "string" || !/^https?:\/\//.test(site.baseUrl)) {
    throw new Error(`Config ${where} needs a "baseUrl" starting with http:// or https://.`);
  }

  const headers = validateHeaders(site.headers, `${where}.headers`);

  const endpoints = site.endpoints ?? {};
  if (typeof endpoints !== "object" || Array.isArray(endpoints)) {
    throw new Error(`Config ${where}.endpoints must be an object.`);
  }

  const clean = {};
  if (endpoints.page == null) {
    clean.page = { path: "/", method: "GET", headers: {}, body: null, expect: null }; // page defaults to "/"
  }
  for (const [key, value] of Object.entries(endpoints)) {
    clean[key] = validateEndpoint(value, `${where}.endpoints.${key}`);
  }

  return { name: site.name, baseUrl: site.baseUrl.replace(/\/+$/, ""), headers, endpoints: clean };
}

// An endpoint is either a path string or an object with request options:
//   "api": "/api/health"
//   "contact": { "path": "/api/contact", "method": "POST", "body": {...}, "headers": {...}, "expect": { "status": 200 } }
// Any number of endpoints with any names is allowed; they become rows in the table.
function validateEndpoint(value, where) {
  if (typeof value === "string") {
    if (!value.startsWith("/")) {
      throw new Error(
        `Config ${where} must be a path starting with "/" (got ${JSON.stringify(value)}).`
      );
    }
    return { path: value, method: "GET", headers: {}, body: null, expect: null };
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const { path, method = "GET", headers = {}, body = null, expect = null } = value;
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(
        `Config ${where}.path must be a path starting with "/" (got ${JSON.stringify(path)}).`
      );
    }
    if (typeof method !== "string" || !HTTP_METHOD_RE.test(method)) {
      throw new Error(
        `Config ${where}.method must be an HTTP verb like "GET" or "POST" (got ${JSON.stringify(method)}).`
      );
    }
    validateHeaders(headers, `${where}.headers`);
    const bodyOut =
      body == null ? null : typeof body === "string" ? body : JSON.stringify(body);
    return {
      path,
      method: method.toUpperCase(),
      headers: { ...headers },
      body: bodyOut,
      expect: validateExpect(expect, `${where}.expect`),
    };
  }

  throw new Error(
    `Config ${where} must be a path string or an object with a "path" (got ${JSON.stringify(value)}).`
  );
}

// "expect": 200 (shorthand) or "expect": { "status": 200 } — requests that
// answer with a different status count as errors.
function validateExpect(expect, where) {
  if (expect == null) return null;
  const obj = typeof expect === "number" ? { status: expect } : expect;
  if (typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(`Config ${where} must be a status code or an object like { "status": 200 }.`);
  }
  const { status } = obj;
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error(
      `Config ${where}.status must be an integer between 100 and 599 (got ${JSON.stringify(status)}).`
    );
  }
  return { status };
}

function validateHeaders(headers, where) {
  const clean = {};
  if (headers == null) return clean;
  if (typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error(`Config ${where} must be an object of header name → value.`);
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      throw new Error(`Config ${where}.${key} must be a string.`);
    }
    clean[key] = value;
  }
  return clean;
}
