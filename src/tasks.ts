import type { Env, NotifyData, NotifyPayload, SendStatus, TaskRecord } from "./types";
import { deriveSendStatus, escapeCsv } from "./validate";

export async function insertTask(
  env: Env,
  projectId: string,
  payload: NotifyPayload,
  extra: Partial<TaskRecord>,
): Promise<number> {
  const sendStatus = extra.sendStatus || "pending";
  const result = await env.DB.prepare(
    `INSERT INTO tasks (
      project_id, source, title, content, level, data,
      email_status, telegram_status, email_message_id, telegram_message_id,
      send_status, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      projectId,
      payload.source,
      payload.title,
      payload.content,
      payload.level,
      JSON.stringify(payload.data),
      extra.emailStatus ?? null,
      extra.telegramStatus ?? null,
      extra.emailMessageId ?? null,
      extra.telegramMessageId ?? null,
      sendStatus,
      extra.error ?? null,
    )
    .run();
  return Number(result.meta.last_row_id);
}

export async function updateTaskOutcome(
  env: Env,
  id: number,
  extra: Partial<TaskRecord>,
): Promise<void> {
  const sendStatus =
    extra.sendStatus ||
    deriveSendStatus({ email: extra.emailStatus, telegram: extra.telegramStatus });
  await env.DB.prepare(
    `UPDATE tasks SET
      email_status = ?, telegram_status = ?, email_message_id = ?, telegram_message_id = ?,
      send_status = ?, error = ?
     WHERE id = ?`,
  )
    .bind(
      extra.emailStatus ?? null,
      extra.telegramStatus ?? null,
      extra.emailMessageId ?? null,
      extra.telegramMessageId ?? null,
      sendStatus,
      extra.error ?? null,
      id,
    )
    .run();
}

export interface TaskFilter {
  projectId?: string;
  status?: SendStatus;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function listTasks(env: Env, filter: TaskFilter): Promise<{ items: TaskRecord[]; total: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.projectId) {
    where.push("project_id = ?");
    binds.push(filter.projectId);
  }
  if (filter.status) {
    where.push("send_status = ?");
    binds.push(filter.status);
  }
  if (filter.from) {
    where.push("created_at >= ?");
    binds.push(filter.from);
  }
  if (filter.to) {
    where.push("created_at <= ?");
    binds.push(filter.to);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) as n FROM tasks ${clause}`)
    .bind(...binds)
    .first<{ n: number }>();
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  const rows = await env.DB.prepare(
    `SELECT * FROM tasks ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();
  return {
    items: (rows.results || []).map(rowToTask),
    total: Number(totalRow?.n || 0),
  };
}

export async function getTask(env: Env, id: number): Promise<TaskRecord | null> {
  const row = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  return row ? rowToTask(row) : null;
}

export async function projectStats(env: Env, projectId: string) {
  const row = await env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN send_status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN send_status = 'partial' THEN 1 ELSE 0 END) as partial,
      SUM(CASE WHEN send_status = 'failed' THEN 1 ELSE 0 END) as failed
     FROM tasks WHERE project_id = ?`,
  )
    .bind(projectId)
    .first<{ total: number; sent: number; partial: number; failed: number }>();
  return {
    total: Number(row?.total || 0),
    sent: Number(row?.sent || 0),
    partial: Number(row?.partial || 0),
    failed: Number(row?.failed || 0),
  };
}

export async function overviewStats(env: Env) {
  const tasks = await env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN send_status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN send_status = 'partial' THEN 1 ELSE 0 END) as partial,
      SUM(CASE WHEN send_status = 'failed' THEN 1 ELSE 0 END) as failed
     FROM tasks`,
  ).first<{ total: number; sent: number; partial: number; failed: number }>();
  const projects = await env.DB.prepare("SELECT COUNT(*) as n FROM projects WHERE deleted = 0").first<{ n: number }>();
  return {
    projects: Number(projects?.n || 0),
    total: Number(tasks?.total || 0),
    sent: Number(tasks?.sent || 0),
    partial: Number(tasks?.partial || 0),
    failed: Number(tasks?.failed || 0),
  };
}

export function tasksToCsv(items: TaskRecord[], names: Record<string, string>): string {
  const header = [
    "id",
    "created_at",
    "project_id",
    "project_name",
    "source",
    "title",
    "level",
    "send_status",
    "email_status",
    "telegram_status",
    "email_message_id",
    "telegram_message_id",
    "total",
    "success",
    "failed",
    "error",
  ];
  const lines = [header.join(",")];
  for (const t of items) {
    lines.push(
      [
        t.id,
        t.createdAt,
        t.projectId,
        names[t.projectId] || "",
        t.source,
        t.title,
        t.level,
        t.sendStatus,
        t.emailStatus || "",
        t.telegramStatus || "",
        t.emailMessageId || "",
        t.telegramMessageId || "",
        t.data?.total ?? "",
        t.data?.success ?? "",
        t.data?.failed ?? "",
        t.error || "",
      ]
        .map((v) => escapeCsv(String(v)))
        .join(","),
    );
  }
  return lines.join("\n");
}

function rowToTask(row: Record<string, unknown>): TaskRecord {
  let data: NotifyData | null = null;
  try {
    data = row.data ? (JSON.parse(String(row.data)) as NotifyData) : null;
  } catch {
    data = null;
  }
  return {
    id: Number(row.id),
    projectId: String(row.project_id),
    source: String(row.source || ""),
    title: String(row.title || ""),
    content: String(row.content || ""),
    level: (row.level as TaskRecord["level"]) || "success",
    data,
    emailStatus: (row.email_status as TaskRecord["emailStatus"]) || null,
    telegramStatus: (row.telegram_status as TaskRecord["telegramStatus"]) || null,
    emailMessageId: row.email_message_id ? String(row.email_message_id) : null,
    telegramMessageId: row.telegram_message_id ? String(row.telegram_message_id) : null,
    sendStatus: (row.send_status as TaskRecord["sendStatus"]) || "pending",
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at),
  };
}
