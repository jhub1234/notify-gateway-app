# Notify Gateway

续期和备份任务的通知中转站。多个项目共用一个网关，各自一把 API Key，按项目开关把结构化结果发到邮件和 Telegram。

技术栈：Cloudflare Workers + KV + D1。管理后台是 Worker 直接输出的 HTML。

续期仓库接入上报接口：[docs/renew-client.md](docs/renew-client.md)。

## 能做什么

- 邮箱 + 密码登录，JWT 写入 HttpOnly Cookie
- 新建 / 编辑 / 软删除项目，默认打开邮件和 Telegram
- 每个项目独立 Base64 Key，HMAC-SHA256 后写入 KV（`project_key:{hash}`）
- `POST /api/notify` 结构化上报，支持 `level=partial` 和多账号混合状态
- 请求通道与项目开关取交集后再发送
- 任务写入 D1，后台可按项目、发送状态、时间筛选，并下载 CSV
- IP 60 次/分钟、项目 120 次/分钟限流；正文不超过 5000 字
- 邮件和 Telegram 失败自动重试 3 次
- 后台「设置」页配置整站 SMTP / Telegram，改完立即生效
- 本地没配 SMTP / Bot 时走 mock，接口和后台仍可完整演示

## 本地运行

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

打开 http://127.0.0.1:43147/setup 创建管理员。需要真发信时，到后台 **设置** 填写 SMTP / Telegram，对外域名只填 `notify.example.com`。然后新建项目，在详情页复制 `NOTIFY_URL` 和 `NOTIFY_TOKEN`。

```bash
export NOTIFY_URL=http://127.0.0.1:43147/api/notify
export NOTIFY_TOKEN='项目完整 Key'
python3 examples/notify.py
```

未配置 SMTP / Telegram 时，通道会返回 `mock_*` messageId，任务仍记为已发送。

```bash
npm test
```

## 部署到 Cloudflare

SMTP / Telegram 仍然在上线后的 **设置** 页填写。部署时只需要 `JWT_SECRET` 和 `KEY_HMAC_SECRET`。

### 方式 A：一键按钮（要公开的 GitHub / GitLab 仓库）

Cloudflare 的按钮只认 `github.com` / `gitlab.com` 的**公开**仓库，会自动：克隆到你的账号、创建 KV + D1、跑 Workers Builds。当前这份如果只在 Cursor Origin 私有仓，按钮点不开，先把代码推到 GitHub 再把下面 URL 换成你的仓库地址。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/2Bdou/notify-gateway)

设置页里按提示填两个密钥（可用 `openssl rand -base64 48` 各生成一串）。部署完成后打开 `https://<worker>.workers.dev/setup`。

### 方式 B：GitHub Actions（私有仓也能用）

把仓库推到 GitHub 后，在 **Settings → Secrets and variables → Actions** 加：

| Secret | 说明 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 自定义 Token：Workers Scripts Edit、Workers KV Storage Edit、D1 Edit、Account Settings Read |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard 右侧 Account ID |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `KEY_HMAC_SECRET` | 另生成一串，不要和 JWT 相同 |

推到 `main` 或手动 **Run workflow** 就会：跑测试 → 没有真实 ID 时自动建 `notify-projects` / `notify-tasks` → 建表 → 部署 Worker → 写入两个 Secret。

工作流文件：`.github/workflows/deploy.yml`。

### 方式 C：本机一条命令

```bash
npx wrangler login
npm run cf:setup
```

会创建（或复用）KV / D1，写入本地 `wrangler.toml`（不要把真实 id 提交进 git），建表并部署。

### 上线后

1. 打开 `https://<worker>/setup` 创建管理员
2. 打开 **设置**：填 SMTP / Telegram；对外域名只填 `notify.example.com`（程序补齐 `https://` 和 `/api/notify`）
3. 后台新建项目，在详情页复制 `NOTIFY_URL` 和 `NOTIFY_TOKEN`（或「复制两行」），配到续期仓库。

后续续期 / 备份仓库怎么调接口、字段和错误码，见 **[docs/renew-client.md](docs/renew-client.md)**。Python 示例：`examples/notify.py`。

Workers 没有完整 Node 运行时，邮件通道用 `cloudflare:sockets` 直连你的第三方 SMTP（465 隐式 TLS / 587 STARTTLS），而不是 nodemailer。

## 接口

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/notify` | POST | 项目 Key 上报 |
| `/api/auth/login` | POST | 登录，返回 JWT |
| `/api/auth/logout` | POST | 登出 |
| `/api/projects` | GET / POST | 项目列表 / 新建 |
| `/api/projects/:id` | PUT / DELETE | 编辑 / 软删除 |
| `/api/projects/:id/regenerate` | POST | 轮换 Key |
| `/api/tasks` | GET | 任务列表 |
| `/api/tasks/:id` | GET | 任务详情 |
| `/api/tasks/export` | GET | 发送日志 CSV |
| `/api/settings` | GET / PUT | 通道设置（密码只回显掩码） |
| `/api/settings/test-email` | POST | 试发邮件 |
| `/api/settings/test-telegram` | POST | 试发 Telegram |
| `/health` | GET | KV / D1 / 通道是否已配齐 |

## 存储

KV

| Key | 含义 |
| --- | --- |
| `admin:{email}` | 管理员密码哈希 |
| `project:{id}` | 项目 JSON |
| `project_key:{keyHash}` | Key → 项目 ID |
| `ratelimit:*` | 限流计数 |
| `settings:channels` | 后台配置的 SMTP / Telegram |

D1 表：`admins`、`projects`、`tasks`。项目删除是软删，任务历史保留，对应 Key 映射立即失效。
