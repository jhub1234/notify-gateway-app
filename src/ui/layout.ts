import { esc } from "./escape";

export function layout(opts: {
  title: string;
  email?: string;
  active?: string;
  body: string;
  flash?: string;
}): string {
  const nav = opts.email
    ? `<aside class="side">
        <a class="brand" href="/dashboard">Notify<span>Gateway</span></a>
        <nav>
          ${navLink("/dashboard", "总览", opts.active)}
          ${navLink("/projects", "项目", opts.active)}
          ${navLink("/tasks", "任务", opts.active)}
          ${navLink("/settings", "设置", opts.active)}
        </nav>
        <div class="who">
          <div>${esc(opts.email)}</div>
          <form method="post" action="/api/auth/logout"><button class="link" type="submit">退出</button></form>
        </div>
      </aside>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)} · Notify Gateway</title>
  <style>${css}</style>
</head>
<body class="${opts.email ? "app" : "gate"}">
  ${nav}
  <main>
    ${opts.flash ? `<div class="flash">${esc(opts.flash)}</div>` : ""}
    ${opts.body}
  </main>
  ${opts.email ? copyScript : ""}
</body>
</html>`;
}

const copyScript = `<script>
document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.getAttribute("data-copy") || "";
    const label = btn.textContent;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      btn.textContent = "已复制";
    } catch {
      btn.textContent = "复制失败";
    }
    setTimeout(() => { btn.textContent = label; }, 1600);
  });
});
</script>`;

function navLink(href: string, label: string, active?: string): string {
  const on = active === href;
  return `<a href="${href}" class="${on ? "on" : ""}">${label}</a>`;
}

const css = `
:root {
  --bg: #0b1020;
  --bg2: #10172b;
  --surface: #141a2e;
  --line: #2a3454;
  --text: #e8eefc;
  --muted: #8b95b7;
  --accent: #6ea8fe;
  --ok: #3ecf8e;
  --warn: #f5a524;
  --bad: #f31260;
  --radius: 10px;
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font: 14px/1.4 "IBM Plex Sans", "Noto Sans SC", "PingFang SC", sans-serif;
  background: radial-gradient(1200px 600px at 10% -10%, #1b2a55 0%, transparent 50%), var(--bg);
  color: var(--text);
}
a { color: var(--accent); text-decoration: none; }
.app { display: grid; grid-template-columns: 196px 1fr; min-height: 100vh; }
.side {
  border-right: 1px solid var(--line);
  padding: 16px 12px;
  background: rgba(11,16,32,.82);
  display: flex; flex-direction: column; gap: 14px;
}
.brand { color: var(--text); font-weight: 700; font-size: 16px; letter-spacing: .02em; }
.brand span { color: var(--accent); }
.side nav { display: flex; flex-direction: column; gap: 2px; }
.side nav a { color: var(--muted); padding: 7px 10px; border-radius: 8px; }
.side nav a.on, .side nav a:hover { background: #1a2340; color: var(--text); }
.who { margin-top: auto; color: var(--muted); font-size: 12px; }
main { padding: 16px 20px 24px; max-width: 1360px; }
.gate main { max-width: 420px; margin: 10vh auto; }
h1 { font-size: 20px; margin: 0; line-height: 1.25; }
.sub { color: var(--muted); margin: 2px 0 10px; font-size: 13px; }
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px 14px;
}
.grid { display: grid; gap: 10px; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
.stat { padding: 8px 10px; }
.stat span { color: var(--muted); font-size: 12px; }
.stat b { display: block; font-size: 18px; margin-top: 2px; font-weight: 650; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
label { display: block; font-size: 12px; color: var(--muted); margin: 0 0 4px; }
input, select, textarea {
  width: 100%; background: var(--bg); color: var(--text);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font: inherit;
}
textarea { min-height: 72px; }
.field { margin-bottom: 8px; }
.field:last-child { margin-bottom: 0; }
button, .btn {
  appearance: none; border: 0; background: var(--accent); color: #081018;
  padding: 6px 11px; border-radius: 8px; font-weight: 650; cursor: pointer; font: inherit; font-size: 13px;
}
button.ghost, .btn.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
button.danger, .btn.danger { background: var(--bad); color: white; }
button.link { background: none; color: var(--accent); padding: 0; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: var(--muted); font-weight: 500; padding: 6px 6px; border-bottom: 1px solid var(--line); }
td { padding: 7px 6px; border-bottom: 1px solid #1d2540; vertical-align: top; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; }
.badge.sent, .badge.success { background: #3ecf8e22; color: var(--ok); }
.badge.partial { background: #f5a52422; color: var(--warn); }
.badge.failed { background: #f3126022; color: var(--bad); }
.badge.pending, .badge.skipped { background: #6ea8fe22; color: var(--accent); }
.flash { background: #1b2a55; border: 1px solid var(--line); padding: 7px 10px; border-radius: 8px; margin-bottom: 10px; font-size: 13px; }
.empty { color: var(--muted); padding: 18px 8px; text-align: center; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
.keybox { background: var(--bg); border: 1px dashed var(--accent); padding: 6px 8px; border-radius: 8px; word-break: break-all; font-size: 12px; }
.filters { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 8px; margin-bottom: 10px; }
.copyrow { display:flex; gap:6px; align-items:stretch; }
.copyrow .keybox { flex:1; margin:0; min-width:0; }
.copyrow button { flex-shrink:0; align-self:center; }
.copy-label { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:6px; }
.copy-label strong { font-size: 13px; }
.chk { display:flex; align-items:center; gap:6px; color:var(--text); font-size:13px; margin:0; }
.chk input { width:auto; }
.settings-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.hint { color:var(--muted); font-size:12px; margin:0 0 8px; }
.okflash { background:#123528; border:1px solid #2a6b4a; color:var(--ok); padding:7px 10px; border-radius:8px; margin-bottom:10px; }
.badflash { background:#3a1020; border:1px solid #6b2a3d; color:#ff8aa8; padding:7px 10px; border-radius:8px; margin-bottom:10px; }
.page-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:10px; }
.page-head .back { margin:0 0 4px; font-size:12px; }
.statline { display:flex; flex-wrap:wrap; gap:6px 16px; align-items:baseline; font-size:13px; color:var(--muted); }
.statline b { color:var(--text); font-size:16px; font-weight:650; }
.cred-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px 12px; }
.detail-grid { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr); gap:10px; align-items:start; }
.inline-host { display:grid; grid-template-columns:minmax(220px,1fr) minmax(220px,1fr) auto; gap:8px; align-items:end; }
.inline-host .copyrow { margin-top:0; }
.tight-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
.channels { display:flex; gap:14px; flex-wrap:wrap; }
@media (max-width: 1100px) {
  .detail-grid, .cred-grid, .inline-host { grid-template-columns:1fr; }
  .stats { grid-template-columns:1fr 1fr; }
}
@media (max-width: 900px) {
  .settings-grid { grid-template-columns:1fr; }
  .app { grid-template-columns: 1fr; }
  .side { border-right: 0; border-bottom: 1px solid var(--line); flex-direction: row; align-items: center; gap: 12px; }
  .side nav { flex-direction: row; flex-wrap: wrap; }
  .who { margin-top: 0; margin-left: auto; }
  .stats, .filters { grid-template-columns: 1fr 1fr; }
  main { padding: 12px; }
  .page-head { flex-direction: column; gap: 8px; }
}
`;
