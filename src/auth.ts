import { getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { hashPassword, jwtSecret, signJwt, verifyJwt, verifyPassword } from "./crypto";
import { sanitizeEmail, validatePassword } from "./validate";
import type { AdminSession, Env } from "./types";

const COOKIE = "ng_session";
const TTL_SEC = 60 * 60 * 12;

export async function createAdmin(env: Env, emailRaw: string, password: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = sanitizeEmail(emailRaw);
  if (!email) return { ok: false, error: "邮箱格式不正确" };
  const pwdErr = validatePassword(password);
  if (pwdErr) return { ok: false, error: pwdErr };

  const existing = await env.DB.prepare("SELECT id FROM admins WHERE email = ?").bind(email).first();
  if (existing) return { ok: false, error: "该邮箱已注册" };

  const hash = await hashPassword(password);
  await env.DB.prepare("INSERT INTO admins (email, password_hash) VALUES (?, ?)").bind(email, hash).run();
  await env.NOTIFY_KV.put(`admin:${email}`, JSON.stringify({ email, password_hash: hash }));
  return { ok: true, email };
}

export async function adminCount(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) as n FROM admins").first<{ n: number }>();
  return Number(row?.n || 0);
}

export async function loginAdmin(
  env: Env,
  emailRaw: string,
  password: string,
): Promise<{ ok: true; token: string; email: string } | { ok: false; error: string }> {
  const email = sanitizeEmail(emailRaw);
  if (!email) return { ok: false, error: "邮箱或密码错误" };

  const kv = await env.NOTIFY_KV.get(`admin:${email}`, "json") as { password_hash?: string } | null;
  let hash = kv?.password_hash;
  if (!hash) {
    const row = await env.DB.prepare("SELECT password_hash FROM admins WHERE email = ?").bind(email).first<{ password_hash: string }>();
    hash = row?.password_hash;
  }
  if (!hash || !(await verifyPassword(password, hash))) {
    return { ok: false, error: "邮箱或密码错误" };
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt(jwtSecret(env.JWT_SECRET), { sub: email, iat: now, exp: now + TTL_SEC });
  return { ok: true, token, email };
}

export async function readSession(c: Context<{ Bindings: Env }>): Promise<AdminSession | null> {
  const header = c.req.header("Authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const cookie = getCookie(c, COOKIE) || "";
  const token = bearer || cookie;
  if (!token) return null;
  const payload = await verifyJwt<{ sub: string; iat: number; exp: number }>(
    jwtSecret(c.env.JWT_SECRET),
    token,
  );
  if (!payload?.sub) return null;
  return { email: payload.sub, iat: payload.iat, exp: payload.exp };
}

export function attachSessionCookie(c: Context, token: string) {
  const secure = new URL(c.req.url).protocol === "https:";
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SEC,
    secure,
  });
}

export function clearSessionCookie(c: Context) {
  setCookie(c, COOKIE, "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}
