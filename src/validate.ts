import type { Channel, Level, NotifyPayload, SendStatus, ChannelStatus } from "./types";

export const CONTENT_MAX = 5000;
export const TITLE_MAX = 200;
export const SOURCE_MAX = 80;

const CHANNELS: Channel[] = ["email", "telegram"];
const LEVELS: Level[] = ["success", "partial", "failed"];
const ACCOUNT_STATUSES = ["success", "failed", "partial"] as const;

export const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
export const TASK_ID_RE = /^\d{1,12}$/;

export function isSafePathSegment(value: string): boolean {
  if (!value) return false;
  if (value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    return false;
  }
  return true;
}

export function assertProjectId(id: string | undefined): id is string {
  return typeof id === "string" && isSafePathSegment(id) && PROJECT_ID_RE.test(id);
}

export function assertTaskId(id: string | undefined): id is string {
  return typeof id === "string" && isSafePathSegment(id) && TASK_ID_RE.test(id);
}

export function intersectChannels(requested: Channel[] | undefined, configured: Channel[]): Channel[] {
  const req = requested?.length ? requested : configured;
  const allowed = new Set(configured);
  return uniqueChannels(req.filter((c) => allowed.has(c)));
}

export function uniqueChannels(channels: Channel[]): Channel[] {
  const seen = new Set<Channel>();
  const out: Channel[] = [];
  for (const c of channels) {
    if (CHANNELS.includes(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export function deriveSendStatus(results: {
  email?: ChannelStatus | null;
  telegram?: ChannelStatus | null;
}): SendStatus {
  const statuses = [results.email, results.telegram].filter(
    (s): s is ChannelStatus => Boolean(s) && s !== "skipped",
  );
  if (statuses.length === 0) return "pending";
  if (statuses.every((s) => s === "pending")) return "pending";
  const sent = statuses.filter((s) => s === "sent").length;
  const failed = statuses.filter((s) => s === "failed").length;
  if (sent > 0 && failed > 0) return "partial";
  if (failed > 0 && sent === 0) return "failed";
  if (sent > 0 && failed === 0 && statuses.every((s) => s === "sent")) return "sent";
  return "pending";
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateNotifyPayload(input: unknown): { ok: true; value: NotifyPayload } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: [{ field: "body", message: "JSON object required" }] };
  }
  const raw = input as Record<string, unknown>;

  const source = asString(raw.source);
  const title = asString(raw.title);
  const content = asString(raw.content);
  if (!source) errors.push({ field: "source", message: "source is required" });
  if (source.length > SOURCE_MAX) errors.push({ field: "source", message: `source must be <= ${SOURCE_MAX}` });
  if (!title) errors.push({ field: "title", message: "title is required" });
  if (title.length > TITLE_MAX) errors.push({ field: "title", message: `title must be <= ${TITLE_MAX}` });
  if (!content) errors.push({ field: "content", message: "content is required" });
  if (content.length > CONTENT_MAX) {
    errors.push({ field: "content", message: `content must be <= ${CONTENT_MAX} characters` });
  }

  const level = (asString(raw.level) || "success") as Level;
  if (!LEVELS.includes(level)) {
    errors.push({ field: "level", message: "level must be success, partial, or failed" });
  }

  let channel: Channel[] = ["email", "telegram"];
  if (raw.channel !== undefined) {
    if (!Array.isArray(raw.channel)) {
      errors.push({ field: "channel", message: "channel must be an array" });
    } else {
      const invalid = raw.channel.filter((c) => !CHANNELS.includes(c as Channel));
      if (invalid.length) {
        errors.push({ field: "channel", message: "channel items must be email or telegram" });
      } else {
        channel = uniqueChannels(raw.channel as Channel[]);
      }
    }
  }

  const dataRaw = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : {};
  const detailsIn = Array.isArray(dataRaw.details) ? dataRaw.details : [];
  const details = [];
  for (const item of detailsIn) {
    if (!item || typeof item !== "object") {
      errors.push({ field: "data.details", message: "each detail must be an object" });
      continue;
    }
    const d = item as Record<string, unknown>;
    const status = asString(d.status) as (typeof ACCOUNT_STATUSES)[number];
    if (!ACCOUNT_STATUSES.includes(status)) {
      errors.push({ field: "data.details.status", message: "status must be success, failed, or partial" });
    }
    details.push({
      id: asString(d.id) || "unknown",
      name: asString(d.name) || asString(d.id) || "unnamed",
      status: ACCOUNT_STATUSES.includes(status) ? status : "failed",
      error: asString(d.error) || undefined,
      message: asString(d.message) || undefined,
    });
  }

  const total = num(dataRaw.total, details.length);
  const success = num(dataRaw.success, details.filter((d) => d.status === "success").length);
  const failed = num(dataRaw.failed, details.filter((d) => d.status === "failed").length);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      source,
      title,
      content,
      level,
      channel,
      data: { total, success, failed, details },
    },
  };
}

export function sanitizeEmail(email: string): string | null {
  const v = email.trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return null;
  if (v.length > 120) return null;
  return v;
}

export function sanitizeFromAddress(value: string): string | null {
  const v = value.trim();
  if (!v) return "";
  if (v.length > 180) return null;
  const angled = v.match(/^(.+)<([^>]+)>$/);
  const addr = sanitizeEmail(angled ? angled[2] : v);
  if (!addr) return null;
  if (!angled) return addr;
  const name = angled[1].trim().replace(/[<>\r\n]/g, "");
  return name ? `${name} <${addr}>` : addr;
}

export const SMTP_PORTS = ["25", "465", "587", "2525"] as const;

export function validSmtpHost(host: string): boolean {
  if (!host) return true;
  if (/\s/.test(host) || /[:/@]/.test(host) || /^https?:/i.test(host)) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}$/.test(host);
}

export function validSmtpPort(port: string): boolean {
  return !port || (SMTP_PORTS as readonly string[]).includes(port);
}

export function validTelegramChatId(id: string): boolean {
  return !id || /^-?\d{1,20}$/.test(id);
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return "password must be at least 8 characters";
  if (password.length > 128) return "password is too long";
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value);
  return fallback;
}

export function parseIsoDate(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?Z?$/.test(value)) return null;
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
