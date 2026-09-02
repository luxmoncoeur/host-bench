// Small statistics helpers shared by the benchmark runner.

export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Nearest-rank percentile on an unsorted sample (p95 of 20 requests = 19th fastest).
export function percentile(xs, p) {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export const round1 = (n) => Math.round(n * 10) / 10;
