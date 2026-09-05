/**
 * `run --local` — discover dev servers already running on this machine by
 * probing the localhost ports where dev servers commonly listen.
 */

export const DEV_PORTS = [3000, 3001, 4000, 4173, 4200, 5000, 5173, 8000, 8080, 8888];

export async function discoverLocalServers(ports = DEV_PORTS, timeoutMs = 400) {
  const found = [];
  for (const port of ports) {
    try {
      // Any HTTP response counts — even a 404 means "a server is listening".
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      found.push({ port, status: res.status });
    } catch {
      // nothing listening (ECONNREFUSED) or no HTTP answer within the timeout
    }
  }
  return found;
}

export function configFromDiscovered(found, opts = {}) {
  return {
    runs: opts.runs ?? 5,
    timeoutMs: opts.timeoutMs ?? 10000,
    warmup: opts.warmup ?? 0,
    delayMs: opts.delayMs ?? 0,
    sites: found.map(({ port }) => ({
      name: `localhost:${port}`,
      baseUrl: `http://127.0.0.1:${port}`,
      headers: {},
      endpoints: { page: { path: "/", method: "GET", headers: {}, body: null, expect: null } },
    })),
  };
}
