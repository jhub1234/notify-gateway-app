import { Hono } from "hono";
import { adminCount, attachSessionCookie, clearSessionCookie, createAdmin, loginAdmin, readSession } from "./auth";
import { handleNotify } from "./notify";
import {
  createProject,
  getProject,
  listProjects,
  publicProject,
  regenerateKey,
  softDeleteProject,
  updateProject,
} from "./projects";
import { ensureSchema } from "./schema";
import { getTask, listTasks, overviewStats, projectStats, tasksToCsv } from "./tasks";
import type { Channel, Env, SendStatus } from "./types";
import {
  assertProjectId,
  assertTaskId,
  parseIsoDate,
} from "./validate";
import { sendEmail } from "./channels/email";
import { sendTelegram } from "./channels/telegram";
import { buildNotifyUrl } from "./notify-url";
import {
  applySettingsPatch,
  emptyStored,
  loadStoredSettings,
  patchFromBody,
  publicSettings,
  resolveChannelConfig,
  saveStoredSettings,
  testPayload,
  validateSettingsPatch,
} from "./settings";
import {
  dashboardPage,
  loginPage,
  projectDetailPage,
  projectsPage,
  settingsPage,
  setupPage,
  taskDetailPage,
  tasksPage,
} from "./ui/pages";

type App = { Bindings: Env };

const app = new Hono<App>();

app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

app.get("/health", async (c) => {
  let kv = false;
  let d1 = false;
  try {
    await c.env.NOTIFY_KV.put("health:ping", "1", { expirationTtl: 60 });
    kv = (await c.env.NOTIFY_KV.get("health:ping")) === "1";
  } catch {
    kv = false;
  }
  try {
    await c.env.DB.prepare("SELECT 1 as ok").first();
    d1 = true;
  } catch {
    d1 = false;
  }
  const channels = resolveChannelConfig(await loadStoredSettings(c.env), c.env);
  return c.json({
    ok: kv && d1,
    service: "notify-gateway",
    version: "0.1.1",
    kv,
    d1,
    smtpConfigured: channels.smtpReady,
    telegramConfigured: channels.telegramReady,
  });
});

app.post("/api/notify", async (c) => {
  return handleNotify(c.env, c.req.raw);
});

app.get("/", async (c) => {
  const n = await adminCount(c.env);
  if (n === 0) return c.redirect("/setup");
  const session = await readSession(c);
  return c.redirect(session ? "/dashboard" : "/login");
});

app.get("/setup", async (c) => {
  if ((await adminCount(c.env)) > 0) return c.redirect("/login");
  return c.html(setupPage());
});

app.post("/api/setup", async (c) => {
  if ((await adminCount(c.env)) > 0) return c.redirect("/login");
  const body = await readBody(c);
  const result = await createAdmin(c.env, str(body.email), str(body.password));
  if (!result.ok) return c.html(setupPage({ error: result.error }), 400);
  const login = await loginAdmin(c.env, result.email, str(body.password));
  if (login.ok) attachSessionCookie(c, login.token);
  return c.redirect("/dashboard");
});

app.get("/login", async (c) => {
  if ((await adminCount(c.env)) === 0) return c.redirect("/setup");
  if (await readSession(c)) return c.redirect("/dashboard");
  return c.html(loginPage({ next: c.req.query("next") || "/dashboard" }));
});

app.post("/api/auth/login", async (c) => {
  const body = await readBody(c);
  const result = await loginAdmin(c.env, str(body.email), str(body.password));
  if (!result.ok) {
    if (wantsHtml(c)) return c.html(loginPage({ error: result.error }), 401);
    return c.json({ success: false, error: result.error }, 401);
  }
  attachSessionCookie(c, result.token);
  if (wantsHtml(c)) return c.redirect(safeNext(str(body.next)));
  return c.json({ success: true, token: result.token, email: result.email });
});

app.post("/api/auth/logout", async (c) => {
  clearSessionCookie(c);
  if (wantsHtml(c)) return c.redirect("/login");
  return c.json({ success: true });
});

app.use("/dashboard", requireAdmin);
app.use("/projects", requireAdmin);
app.use("/projects/*", requireAdmin);
app.use("/tasks", requireAdmin);
app.use("/tasks/*", requireAdmin);
app.use("/settings", requireAdmin);
app.use("/api/projects", requireAdmin);
app.use("/api/projects/*", requireAdmin);
app.use("/api/tasks", requireAdmin);
app.use("/api/tasks/*", requireAdmin);
app.use("/api/settings", requireAdmin);
app.use("/api/settings/*", requireAdmin);

app.get("/dashboard", async (c) => {
  const session = (await readSession(c))!;
  const [stats, recent, projects] = await Promise.all([
    overviewStats(c.env),
    listTasks(c.env, { limit: 8 }),
    listProjects(c.env),
  ]);
  return c.html(dashboardPage(session.email, stats, recent.items, nameMap(projects)));
});

app.get("/projects", async (c) => {
  const session = (await readSession(c))!;
  const projects = await listProjects(c.env);
  return c.html(projectsPage(session.email, projects, c.req.query("flash")));
});

app.get("/projects/:id", async (c) => {
  const id = c.req.param("id");
  if (!assertProjectId(id)) return c.text("Not found", 404);
  const project = await getProject(c.env, id);
  if (!project) return c.text("Not found", 404);
  const session = (await readSession(c))!;
  const stats = await projectStats(c.env, id);
  return c.html(
    projectDetailPage(session.email, project, stats, {
      revealedKey: c.req.query("key") || undefined,
      notifyUrl: await notifyUrlFrom(c),
    }),
  );
});

app.get("/tasks", async (c) => {
  const session = (await readSession(c))!;
  const filter = parseTaskFilter(c);
  const [result, projects] = await Promise.all([listTasks(c.env, filter), listProjects(c.env)]);
  return c.html(
    tasksPage(session.email, result.items, nameMap(projects), projects, {
      projectId: filter.projectId,
      status: filter.status,
      from: c.req.query("from") || "",
      to: c.req.query("to") || "",
    }, result.total),
  );
});

app.get("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  if (!assertTaskId(id)) return c.text("Not found", 404);
  const task = await getTask(c.env, Number(id));
  if (!task) return c.text("Not found", 404);
  const project = await getProject(c.env, task.projectId, true);
  const session = (await readSession(c))!;
  return c.html(taskDetailPage(session.email, task, project?.name || task.projectId));
});

async function saveSettingsHandler(c: import("hono").Context<App>) {
  const session = (await readSession(c))!;
  const stored = (await loadStoredSettings(c.env)) || emptyStored();
  const patch = patchFromBody(await readBody(c));
  patch.updatedBy = session.email;
  const invalid = validateSettingsPatch(patch);
  if (invalid) {
    if (wantsHtml(c)) return c.redirect(`/settings?err=${encodeURIComponent(invalid)}`);
    return c.json({ success: false, error: invalid }, 400);
  }
  const next = applySettingsPatch(stored, patch);
  await saveStoredSettings(c.env, next);
  const item = {
    ...publicSettings(next, c.env),
    notifyUrl: buildNotifyUrl(next.publicHost, new URL(c.req.url).origin),
  };
  if (wantsHtml(c)) return c.redirect("/settings?ok=" + encodeURIComponent("通道设置已保存。"));
  return c.json({ success: true, item });
}

async function testChannelHandler(c: import("hono").Context<App>, channel: "email" | "telegram") {
  const stored = (await loadStoredSettings(c.env)) || emptyStored();
  const patch = patchFromBody(await readBody(c));
  const invalid = validateSettingsPatch(patch);
  if (invalid) {
    if (wantsHtml(c)) return c.redirect(`/settings?err=${encodeURIComponent(invalid)}`);
    return c.json({ success: false, error: invalid }, 400);
  }
  const merged = applySettingsPatch(stored, patch);
  const config = resolveChannelConfig(merged, c.env);
  const payload = testPayload(channel);
  const result =
    channel === "email"
      ? await sendEmail(config.smtp, config.smtpReady, payload)
      : await sendTelegram(config.telegram, config.telegramReady, payload);
  const text = result.mock
    ? `${channel === "email" ? "邮件" : "Telegram"} 未配齐，已走 mock（${result.messageId}）`
    : result.status === "sent"
      ? `测试已发送（${result.messageId || "ok"}）`
      : `测试失败：${result.error || result.status}`;
  if (wantsHtml(c)) {
    const q = result.status === "sent" ? "ok" : "err";
    return c.redirect(`/settings?${q}=${encodeURIComponent(text)}`);
  }
  return c.json({
    success: result.status === "sent",
    mock: result.mock || false,
    result,
  });
}

function settingsFlash(ok?: string, err?: string): { kind: "ok" | "err"; text: string } | undefined {
  if (err) return { kind: "err", text: err };
  if (ok) return { kind: "ok", text: ok };
  return undefined;
}

app.get("/settings", async (c) => {
  const session = (await readSession(c))!;
  const stored = await loadStoredSettings(c.env);
  const flash = settingsFlash(c.req.query("ok"), c.req.query("err"));
  const notifyUrl = await notifyUrlFrom(c);
  return c.html(settingsPage(session.email, publicSettings(stored, c.env), flash, { notifyUrl }));
});

app.get("/api/settings", async (c) => {
  const stored = await loadStoredSettings(c.env);
  return c.json({
    success: true,
    item: { ...publicSettings(stored, c.env), notifyUrl: await notifyUrlFrom(c) },
  });
});

app.put("/api/settings", saveSettingsHandler);
app.post("/api/settings", saveSettingsHandler);

app.post("/api/settings/test-email", (c) => testChannelHandler(c, "email"));
app.post("/api/settings/test-telegram", (c) => testChannelHandler(c, "telegram"));

app.get("/api/projects", async (c) => {
  const projects = await listProjects(c.env);
  return c.json({ success: true, items: projects.map((p) => publicProject(p)) });
});

app.post("/api/projects", async (c) => {
  const body = await readBody(c);
  const name = str(body.name);
  if (!name) return fail(c, "name is required", 400);
  const channels = channelsFrom(body);
  const project = await createProject(c.env, name, channels.length ? channels : ["email", "telegram"]);
  if (wantsHtml(c)) return c.redirect(`/projects/${project.id}?key=${encodeURIComponent(project.apiKey)}`);
  return c.json({ success: true, item: publicProject(project, true), notifyUrl: await notifyUrlFrom(c) }, 201);
});

app.put("/api/projects/:id", updateProjectHandler);
app.post("/api/projects/:id", async (c) => {
  const body = await readBody(c);
  const method = str(body._method).toUpperCase();
  if (method === "DELETE") return deleteProjectHandler(c);
  return updateProjectHandler(c);
});

app.delete("/api/projects/:id", deleteProjectHandler);

app.post("/api/projects/:id/regenerate", async (c) => {
  const id = c.req.param("id");
  if (!assertProjectId(id)) return fail(c, "invalid id", 400);
  const project = await regenerateKey(c.env, id);
  if (!project) return fail(c, "not found", 404);
  if (wantsHtml(c)) return c.redirect(`/projects/${project.id}?key=${encodeURIComponent(project.apiKey)}`);
  return c.json({ success: true, item: publicProject(project, true), notifyUrl: await notifyUrlFrom(c) });
});

app.get("/api/tasks", async (c) => {
  const result = await listTasks(c.env, parseTaskFilter(c));
  return c.json({ success: true, ...result });
});

app.get("/api/tasks/export", async (c) => {
  const result = await listTasks(c.env, { ...parseTaskFilter(c), limit: 2000, offset: 0 });
  const projects = await listProjects(c.env);
  const csv = tasksToCsv(result.items, nameMap(projects));
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="notify-logs.csv"',
    },
  });
});

app.get("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  if (!assertTaskId(id)) return fail(c, "invalid id", 400);
  const task = await getTask(c.env, Number(id));
  if (!task) return fail(c, "not found", 404);
  return c.json({ success: true, item: task });
});

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ success: false, error: "not found" }, 404);
  return c.text("Not found", 404);
});

export default app;

async function requireAdmin(c: import("hono").Context<App>, next: () => Promise<void>) {
  const session = await readSession(c);
  if (!session) {
    if (c.req.path.startsWith("/api/")) return c.json({ success: false, error: "unauthorized" }, 401);
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  }
  await next();
}

async function updateProjectHandler(c: import("hono").Context<App>) {
  const id = c.req.param("id");
  if (!assertProjectId(id)) return fail(c, "invalid id", 400);
  const body = await readBody(c);
  const patch: { name?: string; channels?: Channel[]; enabled?: boolean } = {};
  if (body.name !== undefined) patch.name = str(body.name);
  if (
    body.channels !== undefined ||
    body.channel_email !== undefined ||
    body.channel_telegram !== undefined ||
    wantsHtml(c)
  ) {
    patch.channels = channelsFrom(body);
  }
  if (body.enabled !== undefined || wantsHtml(c)) {
    patch.enabled = body.enabled === undefined ? false : truthy(body.enabled);
  }
  const project = await updateProject(c.env, id, patch);
  if (!project) return fail(c, "not found", 404);
  if (wantsHtml(c)) return c.redirect(`/projects/${project.id}`);
  return c.json({ success: true, item: publicProject(project) });
}

async function deleteProjectHandler(c: import("hono").Context<App>) {
  const id = c.req.param("id");
  if (!assertProjectId(id)) return fail(c, "invalid id", 400);
  const ok = await softDeleteProject(c.env, id);
  if (!ok) return fail(c, "not found", 404);
  if (wantsHtml(c)) return c.redirect("/projects?flash=项目已软删除，历史任务仍保留。");
  return c.json({ success: true });
}

function parseTaskFilter(c: import("hono").Context<App>) {
  const projectId = c.req.query("project_id") || undefined;
  const status = c.req.query("status") as SendStatus | undefined;
  const from = parseIsoDate(c.req.query("from") || undefined) || undefined;
  let to = parseIsoDate(c.req.query("to") || undefined) || undefined;
  if (to && (c.req.query("to") || "").length === 10) {
    to = new Date(Date.parse(to) + 24 * 60 * 60 * 1000 - 1).toISOString();
  }
  return {
    projectId: projectId && assertProjectId(projectId) ? projectId : undefined,
    status: status && ["pending", "sent", "partial", "failed"].includes(status) ? status : undefined,
    from,
    to,
    limit: Number(c.req.query("limit") || 50),
    offset: Number(c.req.query("offset") || 0),
  };
}

function nameMap(projects: { id: string; name: string }[]): Record<string, string> {
  return Object.fromEntries(projects.map((p) => [p.id, p.name]));
}

function channelsFrom(body: Record<string, unknown>): Channel[] {
  if (Array.isArray(body.channels)) {
    return body.channels.filter((c): c is Channel => c === "email" || c === "telegram");
  }
  const out: Channel[] = [];
  if (truthy(body.channel_email)) out.push("email");
  if (truthy(body.channel_telegram)) out.push("telegram");
  return out;
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "on" || value === "true";
}

async function readBody(c: import("hono").Context<App>): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") || "";
  if (type.includes("application/json")) {
    try {
      const data = await c.req.json();
      return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  try {
    const form = await c.req.parseBody();
    return form as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function wantsHtml(c: import("hono").Context): boolean {
  const type = c.req.header("content-type") || "";
  const accept = c.req.header("accept") || "";
  return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data") || accept.includes("text/html");
}

function safeNext(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  return "/dashboard";
}

async function notifyUrlFrom(c: import("hono").Context<App>): Promise<string> {
  const stored = await loadStoredSettings(c.env);
  return buildNotifyUrl(stored?.publicHost || "", new URL(c.req.url).origin);
}

function fail(c: import("hono").Context<App>, error: string, status: 400 | 401 | 404) {
  if (wantsHtml(c)) return c.text(error, status);
  return c.json({ success: false, error }, status);
}

