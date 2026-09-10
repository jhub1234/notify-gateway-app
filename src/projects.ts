import { generateApiKey, hashApiKey, hmacSecret, newId } from "./crypto";
import type { Channel, Env, Project } from "./types";
import { uniqueChannels } from "./validate";

export async function listProjects(env: Env): Promise<Project[]> {
  const rows = await env.DB.prepare(
    "SELECT id, name, api_key, api_key_hash, channels, enabled, deleted, created_at, updated_at FROM projects WHERE deleted = 0 ORDER BY created_at DESC",
  ).all();
  return (rows.results || []).map(rowToProject);
}

export async function getProject(env: Env, id: string, includeDeleted = false): Promise<Project | null> {
  const kv = (await env.NOTIFY_KV.get(`project:${id}`, "json")) as Project | null;
  if (kv && (includeDeleted || !kv.deleted)) return kv;

  const sql = includeDeleted
    ? "SELECT id, name, api_key, api_key_hash, channels, enabled, deleted, created_at, updated_at FROM projects WHERE id = ?"
    : "SELECT id, name, api_key, api_key_hash, channels, enabled, deleted, created_at, updated_at FROM projects WHERE id = ? AND deleted = 0";
  const row = await env.DB.prepare(sql).bind(id).first();
  return row ? rowToProject(row) : null;
}

export async function getProjectByApiKey(env: Env, apiKey: string): Promise<Project | null> {
  const hash = await hashApiKey(hmacSecret(env.KEY_HMAC_SECRET), apiKey);
  const mapped = await env.NOTIFY_KV.get(`project_key:${hash}`);
  if (mapped) {
    const project = await getProject(env, mapped);
    if (project && project.apiKeyHash === hash) return project;
  }
  const row = await env.DB.prepare(
    "SELECT id, name, api_key, api_key_hash, channels, enabled, deleted, created_at, updated_at FROM projects WHERE api_key_hash = ? AND deleted = 0",
  ).bind(hash).first();
  return row ? rowToProject(row) : null;
}

export async function createProject(env: Env, name: string, channels?: Channel[]): Promise<Project> {
  const now = new Date().toISOString();
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(hmacSecret(env.KEY_HMAC_SECRET), apiKey);
  const project: Project = {
    id: newId("prj"),
    name: name.trim(),
    apiKey,
    apiKeyHash,
    channels: uniqueChannels(channels?.length ? channels : ["email", "telegram"]),
    enabled: true,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
  await persistProject(env, project, true);
  return project;
}

export async function updateProject(
  env: Env,
  id: string,
  patch: { name?: string; channels?: Channel[]; enabled?: boolean },
): Promise<Project | null> {
  const current = await getProject(env, id);
  if (!current) return null;
  if (patch.name !== undefined) current.name = patch.name.trim();
  if (patch.channels) current.channels = uniqueChannels(patch.channels);
  if (patch.enabled !== undefined) current.enabled = patch.enabled;
  current.updatedAt = new Date().toISOString();
  await persistProject(env, current, false);
  return current;
}

export async function regenerateKey(env: Env, id: string): Promise<Project | null> {
  const current = await getProject(env, id);
  if (!current) return null;
  await env.NOTIFY_KV.delete(`project_key:${current.apiKeyHash}`);
  current.apiKey = generateApiKey();
  current.apiKeyHash = await hashApiKey(hmacSecret(env.KEY_HMAC_SECRET), current.apiKey);
  current.updatedAt = new Date().toISOString();
  await persistProject(env, current, true);
  return current;
}

export async function softDeleteProject(env: Env, id: string): Promise<boolean> {
  const current = await getProject(env, id);
  if (!current) return false;
  current.deleted = true;
  current.enabled = false;
  current.updatedAt = new Date().toISOString();
  await env.NOTIFY_KV.delete(`project_key:${current.apiKeyHash}`);
  await env.NOTIFY_KV.put(`project:${current.id}`, JSON.stringify(current));
  await env.DB.prepare(
    "UPDATE projects SET deleted = 1, enabled = 0, deleted_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(current.updatedAt, current.updatedAt, current.id)
    .run();
  return true;
}

async function persistProject(env: Env, project: Project, updateKeyMap: boolean) {
  await env.NOTIFY_KV.put(`project:${project.id}`, JSON.stringify(project));
  if (updateKeyMap) {
    await env.NOTIFY_KV.put(`project_key:${project.apiKeyHash}`, project.id);
  }
  await env.DB.prepare(
    `INSERT INTO projects (id, name, api_key, api_key_hash, channels, enabled, deleted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       api_key = excluded.api_key,
       api_key_hash = excluded.api_key_hash,
       channels = excluded.channels,
       enabled = excluded.enabled,
       deleted = excluded.deleted,
       updated_at = excluded.updated_at`,
  )
    .bind(
      project.id,
      project.name,
      project.apiKey,
      project.apiKeyHash,
      JSON.stringify(project.channels),
      project.enabled ? 1 : 0,
      project.deleted ? 1 : 0,
      project.createdAt,
      project.updatedAt,
    )
    .run();
}

export function publicProject(project: Project, revealKey = false) {
  return {
    id: project.id,
    name: project.name,
    apiKey: revealKey ? project.apiKey : maskKey(project.apiKey),
    channels: project.channels,
    enabled: project.enabled,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function rowToProject(row: Record<string, unknown>): Project {
  let channels: Channel[] = ["email", "telegram"];
  try {
    channels = uniqueChannels(JSON.parse(String(row.channels || "[]")));
  } catch {
    /* keep default */
  }
  return {
    id: String(row.id),
    name: String(row.name),
    apiKey: String(row.api_key),
    apiKeyHash: String(row.api_key_hash),
    channels: channels.length ? channels : ["email", "telegram"],
    enabled: Number(row.enabled) === 1,
    deleted: Number(row.deleted) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
