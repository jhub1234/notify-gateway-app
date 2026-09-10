import { sendEmail } from "./channels/email";
import { sendTelegram } from "./channels/telegram";
import { getProjectByApiKey } from "./projects";
import { clientIp, consumeRateLimit, rateLimits } from "./rate-limit";
import { loadChannelConfig } from "./settings";
import { insertTask, updateTaskOutcome } from "./tasks";
import type { Channel, ChannelResult, Env, NotifyPayload } from "./types";
import { deriveSendStatus, intersectChannels, validateNotifyPayload } from "./validate";

export async function handleNotify(env: Env, request: Request): Promise<Response> {
  const limits = rateLimits(env);
  const ip = clientIp(request);
  const ipLimit = await consumeRateLimit(env.NOTIFY_KV, `ip:${ip}`, limits.ip);
  if (!ipLimit.allowed) {
    return json({ success: false, error: "rate limited (ip)" }, 429, {
      "Retry-After": String(ipLimit.retryAfter),
    });
  }

  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ") || !auth.slice(7).trim()) {
    return json({ success: false, error: "missing project API key" }, 401);
  }
  const apiKey = auth.slice(7).trim();
  const project = await getProjectByApiKey(env, apiKey);
  if (!project) {
    return json({ success: false, error: "invalid project API key" }, 401);
  }
  if (!project.enabled) {
    return json({ success: false, error: "project is disabled" }, 403);
  }

  const projLimit = await consumeRateLimit(env.NOTIFY_KV, `project:${project.id}`, limits.project);
  if (!projLimit.allowed) {
    return json({ success: false, error: "rate limited (project)" }, 429, {
      "Retry-After": String(projLimit.retryAfter),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "invalid JSON" }, 400);
  }
  const parsed = validateNotifyPayload(body);
  if (!parsed.ok) {
    return json({ success: false, error: "validation failed", errors: parsed.errors }, 400);
  }

  const payload = parsed.value;
  const active = intersectChannels(payload.channel, project.channels);
  const taskId = await insertTask(env, project.id, payload, { sendStatus: "pending" });
  const config = await loadChannelConfig(env);

  const channels: Record<string, ChannelResult> = {};
  const errors: string[] = [];

  await Promise.all(
    (["email", "telegram"] as Channel[]).map(async (ch) => {
      if (!active.includes(ch)) {
        channels[ch] = { status: "skipped" };
        return;
      }
      const result =
        ch === "email"
          ? await sendEmail(config.smtp, config.smtpReady, payload)
          : await sendTelegram(config.telegram, config.telegramReady, payload);
      channels[ch] = result;
      if (result.status === "failed" && result.error) errors.push(`${ch}: ${result.error}`);
    }),
  );

  const sendStatus = deriveSendStatus({
    email: channels.email?.status,
    telegram: channels.telegram?.status,
  });

  await updateTaskOutcome(env, taskId, {
    emailStatus: channels.email?.status,
    telegramStatus: channels.telegram?.status,
    emailMessageId: channels.email?.messageId,
    telegramMessageId: channels.telegram?.messageId,
    sendStatus,
    error: errors.length ? errors.join("; ") : null,
  });

  return json({
    success: sendStatus !== "failed",
    taskId,
    projectId: project.id,
    channels: Object.fromEntries(
      Object.entries(channels).map(([k, v]) => [
        k,
        { status: v.status, messageId: v.messageId, error: v.error, mock: v.mock },
      ]),
    ),
    level: payload.level,
    data: {
      total: payload.data.total,
      success: payload.data.success,
      failed: payload.data.failed,
    },
    timestamp: new Date().toISOString(),
  });
}

export function summarizePayload(payload: NotifyPayload) {
  return {
    source: payload.source,
    title: payload.title,
    level: payload.level,
    data: {
      total: payload.data.total,
      success: payload.data.success,
      failed: payload.data.failed,
    },
  };
}

function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}
