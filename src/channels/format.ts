import type { Level, NotifyPayload } from "../types";

const LEVEL_LABEL: Record<Level, string> = {
  success: "成功",
  partial: "部分失败",
  failed: "失败",
};

export function emailSubject(payload: NotifyPayload): string {
  return `[${payload.source}] ${payload.title}`;
}

export function emailText(payload: NotifyPayload): string {
  const lines = [
    `${payload.title}`,
    `来源: ${payload.source}`,
    `级别: ${LEVEL_LABEL[payload.level]} (${payload.level})`,
    "",
    payload.content,
    "",
    `总计 ${payload.data.total} · 成功 ${payload.data.success} · 失败 ${payload.data.failed}`,
  ];
  if (payload.data.details.length) {
    lines.push("", "明细:");
    for (const d of payload.data.details) {
      const extra = d.error || d.message || "";
      lines.push(`- ${d.name} (${d.id}): ${d.status}${extra ? ` — ${extra}` : ""}`);
    }
  }
  return lines.join("\n");
}

export function emailHtml(payload: NotifyPayload): string {
  const tone =
    payload.level === "success" ? "#3ecf8e" : payload.level === "partial" ? "#f5a524" : "#f31260";
  const rows = payload.data.details
    .map((d) => {
      const extra = escapeHtml(d.error || d.message || "");
      return `<tr>
        <td>${escapeHtml(d.name)}</td>
        <td><code>${escapeHtml(d.id)}</code></td>
        <td><span class="st ${d.status}">${escapeHtml(d.status)}</span></td>
        <td>${extra}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: "IBM Plex Sans", "Noto Sans SC", sans-serif; background:#0b1020; color:#e8eefc; margin:0; padding:24px; }
  .card { max-width:640px; margin:0 auto; background:#141a2e; border:1px solid #2a3454; border-radius:16px; overflow:hidden; }
  .hd { padding:20px 24px; border-bottom:1px solid #2a3454; }
  .badge { display:inline-block; padding:4px 10px; border-radius:999px; background:${tone}22; color:${tone}; font-size:12px; letter-spacing:.04em; }
  h1 { font-size:20px; margin:10px 0 4px; }
  .meta { color:#8b95b7; font-size:13px; }
  .bd { padding:24px; }
  .stats { display:flex; gap:12px; margin:0 0 20px; }
  .stat { flex:1; background:#0b1020; border:1px solid #2a3454; border-radius:12px; padding:12px; }
  .stat b { display:block; font-size:22px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#8b95b7; font-weight:500; padding:8px; border-bottom:1px solid #2a3454; }
  td { padding:8px; border-bottom:1px solid #1d2540; vertical-align:top; }
  .st.success { color:#3ecf8e; } .st.failed { color:#f31260; } .st.partial { color:#f5a524; }
  p { line-height:1.6; white-space:pre-wrap; }
</style></head>
<body>
  <div class="card">
    <div class="hd">
      <span class="badge">${escapeHtml(LEVEL_LABEL[payload.level])} · ${escapeHtml(payload.level)}</span>
      <h1>${escapeHtml(payload.title)}</h1>
      <div class="meta">${escapeHtml(payload.source)}</div>
    </div>
    <div class="bd">
      <div class="stats">
        <div class="stat"><span>总计</span><b>${payload.data.total}</b></div>
        <div class="stat"><span>成功</span><b>${payload.data.success}</b></div>
        <div class="stat"><span>失败</span><b>${payload.data.failed}</b></div>
      </div>
      <p>${escapeHtml(payload.content)}</p>
      ${
        rows
          ? `<table><thead><tr><th>账号</th><th>ID</th><th>状态</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`
          : ""
      }
    </div>
  </div>
</body></html>`;
}

export function telegramText(payload: NotifyPayload): string {
  const icon = payload.level === "success" ? "✅" : payload.level === "partial" ? "⚠️" : "❌";
  const lines = [
    `${icon} [${payload.level}] ${payload.title}`,
    `来源: ${payload.source}`,
    "",
    payload.content,
    "",
    `总计 ${payload.data.total} · 成功 ${payload.data.success} · 失败 ${payload.data.failed}`,
  ];
  if (payload.data.details.length) {
    lines.push("");
    for (const d of payload.data.details) {
      const mark = d.status === "success" ? "•" : d.status === "partial" ? "◐" : "×";
      const extra = d.error || d.message || "";
      lines.push(`${mark} ${d.name} — ${d.status}${extra ? ` — ${extra}` : ""}`);
    }
  }
  return lines.join("\n").slice(0, 3900);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
