/**
 * Round 3 — small statistics shared by the Prove / Optimise / Audit / Prevent
 * services. Every function is pure and deterministic: the bootstrap uses a
 * seeded generator, so the same data always gives the same interval.
 */

export const round = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

export function mean(values) {
  return values.length ? values.reduce((t, v) => t + v, 0) / values.length : null;
}

/** Linear-interpolated quantile (the same rule as numpy's default). */
export function quantile(values, q) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export const median = (values) => quantile(values, 0.5);

/** Least-squares slope of y against x = 0, 1, 2, … */
export function slope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(values);
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  });
  return den ? num / den : 0;
}

/** mulberry32: a tiny seeded PRNG, so a bootstrap is reproducible. */
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One resample with replacement. */
export function resample(values, random) {
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) out[i] = values[Math.floor(random() * values.length)];
  return out;
}

/**
 * Percentile bootstrap. `groups` is an array of samples; each is resampled
 * independently, then `statistic(...resampled)` is computed. Returns the
 * (1-level)/2 and (1+level)/2 percentiles of the statistic.
 */
export function bootstrap(groups, statistic, { iterations = 1000, level = 0.9, seed = 42 } = {}) {
  const random = rng(seed);
  const stats = [];
  for (let i = 0; i < iterations; i += 1) {
    const v = statistic(...groups.map((g) => resample(g, random)));
    if (Number.isFinite(v)) stats.push(v);
  }
  return {
    low: quantile(stats, (1 - level) / 2),
    high: quantile(stats, (1 + level) / 2),
    iterations,
    level,
    seed,
    valid: stats.length
  };
}

/**
 * Gini coefficient of a load distribution:
 *   G = Σᵢ Σⱼ |xᵢ − xⱼ| / (2 n² μ)
 * 0 = everyone carries the same load; → 1 = one person carries all of it.
 */
export function gini(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0);
  const n = xs.length;
  const mu = mean(xs);
  if (!n || !mu) return null;
  let sum = 0;
  for (const a of xs) for (const b of xs) sum += Math.abs(a - b);
  return sum / (2 * n * n * mu);
}

export const DAY = 864e5;
export const HOUR = 36e5;
