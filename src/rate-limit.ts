import type { Env } from "./types";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfter: number;
}

export async function consumeRateLimit(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSec = 60,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const kvKey = `ratelimit:${key}:${bucket}`;
  const current = Number((await kv.get(kvKey)) || "0");
  if (current >= limit) {
    const retryAfter = windowSec - Math.floor((Date.now() / 1000) % windowSec);
    return { allowed: false, remaining: 0, limit, retryAfter };
  }
  await kv.put(kvKey, String(current + 1), { expirationTtl: windowSec + 5 });
  return { allowed: true, remaining: Math.max(0, limit - current - 1), limit, retryAfter: 0 };
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

export function rateLimits(env: Env): { ip: number; project: number } {
  return {
    ip: clampInt(env.RATE_LIMIT_IP, 60, 1, 10_000),
    project: clampInt(env.RATE_LIMIT_PROJECT, 120, 1, 10_000),
  };
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 200): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1) {
        await sleep(baseMs * 2 ** i);
      }
    }
  }
  throw last;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
