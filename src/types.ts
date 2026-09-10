export type Channel = "email" | "telegram";
export type Level = "success" | "partial" | "failed";
export type ChannelStatus = "pending" | "sent" | "failed" | "skipped";
export type SendStatus = "pending" | "sent" | "partial" | "failed";
export type AccountStatus = "success" | "failed" | "partial";

export interface Env {
  NOTIFY_KV: KVNamespace;
  DB: D1Database;
  JWT_SECRET?: string;
  KEY_HMAC_SECRET?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  SMTP_TO?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  APP_NAME?: string;
  RATE_LIMIT_IP?: string;
  RATE_LIMIT_PROJECT?: string;
}

export interface AccountDetail {
  id: string;
  name: string;
  status: AccountStatus;
  error?: string;
  message?: string;
}

export interface NotifyData {
  total: number;
  success: number;
  failed: number;
  details: AccountDetail[];
}

export interface NotifyPayload {
  source: string;
  title: string;
  content: string;
  level: Level;
  channel: Channel[];
  data: NotifyData;
}

export interface Project {
  id: string;
  name: string;
  apiKey: string;
  apiKeyHash: string;
  channels: Channel[];
  enabled: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: number;
  projectId: string;
  source: string;
  title: string;
  content: string;
  level: Level;
  data: NotifyData | null;
  emailStatus: ChannelStatus | null;
  telegramStatus: ChannelStatus | null;
  emailMessageId: string | null;
  telegramMessageId: string | null;
  sendStatus: SendStatus;
  error: string | null;
  createdAt: string;
}

export interface ChannelResult {
  status: ChannelStatus;
  messageId?: string;
  error?: string;
  mock?: boolean;
}

export interface AdminSession {
  email: string;
  iat: number;
  exp: number;
}
