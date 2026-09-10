import { maskKey } from "./projects";
import type { Env } from "./types";
import { validatePublicHost } from "./notify-url";
import {
  sanitizeEmail,
  sanitizeFromAddress,
  validSmtpHost,
  validSmtpPort,
  validTelegramChatId,
} from "./validate";

export const SETTINGS_KEY = "settings:channels";

export interface SmtpFields {
  host: string;
  port: string;
  user: string;
  password?: string;
  from: string;
  to: string;
}

export interface TelegramFields {
  botToken?: string;
  chatId: string;
}

export interface StoredSettings {
  smtp: SmtpFields;
  telegram: TelegramFields;
  publicHost: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface SettingsPatch {
  smtp?: Partial<SmtpFields> & { clearPassword?: boolean };
  telegram?: Partial<TelegramFields> & { clearToken?: boolean };
  publicHost?: string;
  updatedBy?: string;
}

export interface SmtpConfig {
  host: string;
  port: string;
  user: string;
  password: string;
  from: string;
  to: string;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface ChannelConfig {
  smtp: SmtpConfig;
  telegram: TelegramConfig;
  smtpReady: boolean;
  telegramReady: boolean;
}

export interface PublicSettings {
  smtp: {
    host: string;
    port: string;
    user: string;
    from: string;
    to: string;
    passwordSet: boolean;
    password: string;
  };
  telegram: {
    chatId: string;
    tokenSet: boolean;
    botToken: string;
  };
  publicHost: string;
  smtpReady: boolean;
  telegramReady: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export function emptyStored(): StoredSettings {
  return {
    smtp: { host: "", port: "", user: "", from: "", to: "" },
    telegram: { chatId: "" },
    publicHost: "",
  };
}

export function envFallback(env: Env): StoredSettings {
  return {
    smtp: {
      host: env.SMTP_HOST || "",
      port: env.SMTP_PORT || "",
      user: env.SMTP_USER || "",
      password: env.SMTP_PASSWORD || "",
      from: env.SMTP_FROM || "",
      to: env.SMTP_TO || "",
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || "",
      chatId: env.TELEGRAM_CHAT_ID || "",
    },
    publicHost: "",
  };
}

export function applySettingsPatch(stored: StoredSettings, patch: SettingsPatch): StoredSettings {
  const smtp = { ...stored.smtp };
  const telegram = { ...stored.telegram };
  if (patch.smtp) {
    if (patch.smtp.host !== undefined) smtp.host = patch.smtp.host.trim();
    if (patch.smtp.port !== undefined) smtp.port = patch.smtp.port.trim();
    if (patch.smtp.user !== undefined) smtp.user = patch.smtp.user.trim();
    if (patch.smtp.from !== undefined) smtp.from = patch.smtp.from.trim();
    if (patch.smtp.to !== undefined) smtp.to = patch.smtp.to.trim();
    if (patch.smtp.clearPassword) smtp.password = "";
    else if (patch.smtp.password !== undefined && patch.smtp.password !== "") {
      smtp.password = patch.smtp.password;
    }
  }
  if (patch.telegram) {
    if (patch.telegram.chatId !== undefined) telegram.chatId = patch.telegram.chatId.trim();
    if (patch.telegram.clearToken) telegram.botToken = "";
    else if (patch.telegram.botToken !== undefined && patch.telegram.botToken !== "") {
      telegram.botToken = patch.telegram.botToken;
    }
  }
  return {
    smtp,
    telegram,
    publicHost: patch.publicHost !== undefined ? patch.publicHost.trim() : stored.publicHost || "",
    updatedAt: new Date().toISOString(),
    updatedBy: patch.updatedBy || stored.updatedBy,
  };
}

export function resolveChannelConfig(stored: StoredSettings | null, env: Env): ChannelConfig {
  const fallback = envFallback(env);
  const smtpPassword =
    stored && stored.smtp.password !== undefined ? stored.smtp.password : fallback.smtp.password || "";
  const botToken =
    stored && stored.telegram.botToken !== undefined
      ? stored.telegram.botToken
      : fallback.telegram.botToken || "";

  const smtp: SmtpConfig = {
    host: pick(stored?.smtp.host, fallback.smtp.host),
    port: pick(stored?.smtp.port, fallback.smtp.port) || "587",
    user: pick(stored?.smtp.user, fallback.smtp.user),
    password: smtpPassword,
    from: pick(stored?.smtp.from, fallback.smtp.from),
    to: pick(stored?.smtp.to, fallback.smtp.to),
  };
  if (!smtp.from) smtp.from = smtp.user;
  if (!smtp.to) smtp.to = smtp.user;

  const telegram: TelegramConfig = {
    botToken,
    chatId: pick(stored?.telegram.chatId, fallback.telegram.chatId),
  };

  return {
    smtp,
    telegram,
    smtpReady: Boolean(smtp.host && smtp.user && smtp.password),
    telegramReady: Boolean(telegram.botToken && telegram.chatId),
  };
}

export function publicSettings(stored: StoredSettings | null, env: Env): PublicSettings {
  const resolved = resolveChannelConfig(stored, env);
  const passwordSet = Boolean(resolved.smtp.password);
  const tokenSet = Boolean(resolved.telegram.botToken);
  return {
    smtp: {
      host: resolved.smtp.host,
      port: resolved.smtp.port,
      user: resolved.smtp.user,
      from: resolved.smtp.from,
      to: resolved.smtp.to,
      passwordSet,
      password: passwordSet ? maskKey(resolved.smtp.password) : "",
    },
    telegram: {
      chatId: resolved.telegram.chatId,
      tokenSet,
      botToken: tokenSet ? maskKey(resolved.telegram.botToken) : "",
    },
    publicHost: stored?.publicHost || "",
    smtpReady: resolved.smtpReady,
    telegramReady: resolved.telegramReady,
    updatedAt: stored?.updatedAt,
    updatedBy: stored?.updatedBy,
  };
}

export function validateSettingsPatch(patch: SettingsPatch): string | null {
  if (patch.smtp) {
    if (patch.smtp.host !== undefined && !validSmtpHost(patch.smtp.host.trim())) {
      return "SMTP Host 只能是主机名，不能带协议或路径";
    }
    if (patch.smtp.port !== undefined && !validSmtpPort(patch.smtp.port.trim())) {
      return "SMTP 端口只支持 25 / 465 / 587 / 2525";
    }
    if (patch.smtp.user && !sanitizeEmail(patch.smtp.user) && patch.smtp.user.includes("@")) {
      return "SMTP 用户名如果是邮箱，格式需正确";
    }
    if (patch.smtp.from !== undefined && patch.smtp.from.trim()) {
      if (!sanitizeFromAddress(patch.smtp.from)) return "SMTP From 格式不正确";
    }
    if (patch.smtp.to !== undefined && patch.smtp.to.trim()) {
      if (!sanitizeEmail(patch.smtp.to)) return "SMTP To 必须是有效邮箱";
    }
  }
  if (patch.telegram?.chatId !== undefined && !validTelegramChatId(patch.telegram.chatId.trim())) {
    return "Telegram Chat ID 只能是数字（可带负号）";
  }
  if (patch.publicHost !== undefined) {
    const hostErr = validatePublicHost(patch.publicHost);
    if (hostErr) return hostErr;
  }
  return null;
}

export async function loadStoredSettings(env: Env): Promise<StoredSettings | null> {
  const raw = await env.NOTIFY_KV.get(SETTINGS_KEY, "json");
  if (!raw || typeof raw !== "object") return null;
  return normalizeStored(raw as Record<string, unknown>);
}

export async function saveStoredSettings(env: Env, settings: StoredSettings): Promise<void> {
  await env.NOTIFY_KV.put(SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadChannelConfig(env: Env): Promise<ChannelConfig> {
  return resolveChannelConfig(await loadStoredSettings(env), env);
}

export function testPayload(channel: "email" | "telegram") {
  const title = channel === "email" ? "SMTP 测试" : "Telegram 测试";
  return {
    source: "notify-gateway",
    title,
    content: "这是系统设置页发出的测试消息。",
    level: "success" as const,
    channel: [channel],
    data: {
      total: 1,
      success: 1,
      failed: 0,
      details: [{ id: "settings-test", name: "系统设置", status: "success" as const }],
    },
  };
}

export function patchFromBody(body: Record<string, unknown>): SettingsPatch {
  const smtpSrc = isRecord(body.smtp) ? body.smtp : body;
  const tgSrc = isRecord(body.telegram) ? body.telegram : body;
  const smtp: SettingsPatch["smtp"] = {};
  const telegram: SettingsPatch["telegram"] = {};

  if (has(smtpSrc, "smtp_host") || has(smtpSrc, "host")) smtp.host = str(smtpSrc.smtp_host ?? smtpSrc.host);
  if (has(smtpSrc, "smtp_port") || has(smtpSrc, "port")) smtp.port = str(smtpSrc.smtp_port ?? smtpSrc.port);
  if (has(smtpSrc, "smtp_user") || has(smtpSrc, "user")) smtp.user = str(smtpSrc.smtp_user ?? smtpSrc.user);
  if (has(smtpSrc, "smtp_password") || has(smtpSrc, "password")) {
    smtp.password = str(smtpSrc.smtp_password ?? smtpSrc.password);
  }
  if (has(smtpSrc, "smtp_from") || has(smtpSrc, "from")) smtp.from = str(smtpSrc.smtp_from ?? smtpSrc.from);
  if (has(smtpSrc, "smtp_to") || has(smtpSrc, "to")) smtp.to = str(smtpSrc.smtp_to ?? smtpSrc.to);
  if (truthy(body.clear_smtp_password) || truthy(smtpSrc.clearPassword)) smtp.clearPassword = true;

  if (has(tgSrc, "telegram_bot_token") || has(tgSrc, "botToken") || has(tgSrc, "bot_token")) {
    telegram.botToken = str(tgSrc.telegram_bot_token ?? tgSrc.botToken ?? tgSrc.bot_token);
  }
  if (has(tgSrc, "telegram_chat_id") || has(tgSrc, "chatId") || has(tgSrc, "chat_id")) {
    telegram.chatId = str(tgSrc.telegram_chat_id ?? tgSrc.chatId ?? tgSrc.chat_id);
  }
  if (truthy(body.clear_telegram_token) || truthy(tgSrc.clearToken)) telegram.clearToken = true;

  const patch: SettingsPatch = { smtp, telegram };
  if (has(body, "public_host") || has(body, "publicHost")) {
    patch.publicHost = str(body.public_host ?? body.publicHost);
  }
  return patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function pick(stored: string | undefined, fallback: string): string {
  return stored && stored.trim() ? stored.trim() : fallback;
}

function normalizeStored(raw: Record<string, unknown>): StoredSettings {
  const smtp = (raw.smtp && typeof raw.smtp === "object" ? raw.smtp : raw) as Record<string, unknown>;
  const telegram = (raw.telegram && typeof raw.telegram === "object" ? raw.telegram : {}) as Record<
    string,
    unknown
  >;
  const out = emptyStored();
  out.smtp.host = str(smtp.host);
  out.smtp.port = str(smtp.port);
  out.smtp.user = str(smtp.user);
  out.smtp.from = str(smtp.from);
  out.smtp.to = str(smtp.to);
  if (Object.prototype.hasOwnProperty.call(smtp, "password")) out.smtp.password = str(smtp.password);
  out.telegram.chatId = str(telegram.chatId ?? telegram.chat_id);
  if (
    Object.prototype.hasOwnProperty.call(telegram, "botToken") ||
    Object.prototype.hasOwnProperty.call(telegram, "bot_token")
  ) {
    out.telegram.botToken = str(telegram.botToken ?? telegram.bot_token);
  }
  out.publicHost = str(raw.publicHost ?? raw.public_host);
  if (typeof raw.updatedAt === "string") out.updatedAt = raw.updatedAt;
  if (typeof raw.updatedBy === "string") out.updatedBy = raw.updatedBy;
  return out;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "on" || value === "true";
}
