# 续期项目怎么上报

这份文档给**后续每个续期 / 备份仓库**用。网关只收结构化结果，再按项目开关发邮件和 Telegram。续期仓库里**不要**配 SMTP、Bot Token、收件人。

可运行的 Python 示例：[`examples/notify.py`](../examples/notify.py)。

## 1. 在网关里建一个项目

一个续期仓库对应网关里的**一个项目**，各用一把 Key，不要共用。

1. 管理员登录通知网关后台。
2. **设置**里配好整站 SMTP / Telegram；对外域名只填 `notify.example.com`（程序会补成 `https://notify.example.com/api/notify`）。
3. **项目 → 新建**，名称建议和仓库一致，例如 `puratya-renew`。
4. 创建后立刻复制（完整 Token 只显示一次）：

```text
NOTIFY_URL=https://notify.example.com/api/notify
NOTIFY_TOKEN=该项目独立密钥
```

5. 写进该仓库的 GitHub Secrets / 环境变量。本地调试可以 `export` 这两项。

重新生成 Key 后，旧 Token 立刻失效，记得同步改 Secrets。

## 2. 调用约定

```
POST {NOTIFY_URL}
Authorization: Bearer {NOTIFY_TOKEN}
Content-Type: application/json
```

`NOTIFY_URL` 必须是完整上报地址，以 `/api/notify` 结尾。不要把 Token 放进 URL 或 JSON body。

建议超时 10 秒。上报失败不要让续期主流程崩溃：记日志即可，需要的话再重试一两次。

## 3. 请求体

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `source` | 是 | 调用来源，一般写仓库名，最长 80 |
| `title` | 是 | 短标题，会出现在邮件主题 `[source] title`，最长 200 |
| `content` | 是 | 正文摘要，最长 5000 字 |
| `level` | 否 | 这次**续期结果**：`success` / `partial` / `failed`，默认 `success` |
| `channel` | 否 | 希望走的通道：`email`、`telegram`。默认两个都要。最终发送 = 请求 ∩ 项目开关 |
| `data` | 否 | 账号汇总，见下表 |

`data`：

| 字段 | 说明 |
| --- | --- |
| `total` | 账号总数。不传则用 `details` 条数 |
| `success` | 成功数。不传则按 `details` 里 `status=success` 计数 |
| `failed` | 失败数。不传则按 `details` 里 `status=failed` 计数 |
| `details` | 账号明细数组 |

`details[]`：

| 字段 | 说明 |
| --- | --- |
| `id` | 账号 / 站点 ID，缺省为 `unknown` |
| `name` | 显示名，缺省用 `id` |
| `status` | `success` / `failed` / `partial`，必填（有明细时） |
| `error` | 失败原因，会进邮件和 Telegram |
| `message` | 补充说明，例如 `1/2 续期成功` |

`level` 表示任务本身成不成功，和网关有没有把信发出去不是一回事。五个账号里三个成功，应报 `partial`，不要报 `success`。

收件人和 Bot 由网关设置页决定。请求里指定 To / Chat ID **无效**。

## 4. 最小例子

全部成功、没有分账号：

```json
{
  "source": "puratya-renew",
  "title": "MWS 续期完成",
  "content": "3 个账号全部续期成功。",
  "level": "success"
}
```

部分失败、带明细（推荐）：

```json
{
  "source": "puratya-renew",
  "title": "MWS 续期完成",
  "content": "续期完成报告",
  "level": "partial",
  "channel": ["email", "telegram"],
  "data": {
    "total": 5,
    "success": 3,
    "failed": 2,
    "details": [
      { "id": "bot_001", "name": "Bot A", "status": "success" },
      { "id": "bot_002", "name": "Bot B", "status": "failed", "error": "HTTP 403" },
      { "id": "site_001", "name": "Site C", "status": "partial", "message": "1/2 续期成功" }
    ]
  }
}
```

## 5. 各语言怎么发

### curl

```bash
curl -sS -X POST "$NOTIFY_URL" \
  -H "Authorization: Bearer $NOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "puratya-renew",
    "title": "MWS 续期完成",
    "content": "续期完成报告",
    "level": "success"
  }'
```

### Python

把 [`examples/notify.py`](../examples/notify.py) 拷进续期仓库，或按同样方式 `urllib.request` / `httpx` POST。环境变量读 `NOTIFY_URL`、`NOTIFY_TOKEN`。

```python
from notify import notify

notify(
    "MWS 续期完成",
    "3 个账号全部续期成功。",
    level="success",
    source="puratya-renew",
)
```

### GitHub Actions

仓库 Secrets 加 `NOTIFY_URL`、`NOTIFY_TOKEN`，在续期 job 最后一步调用：

```yaml
- name: 上报通知网关
  if: always()
  env:
    NOTIFY_URL: ${{ secrets.NOTIFY_URL }}
    NOTIFY_TOKEN: ${{ secrets.NOTIFY_TOKEN }}
  run: |
    python3 notify.py
```

`if: always()` 保证续期失败也会上报。按实际结果设 `level`：全成功 `success`，有失败 `partial` 或 `failed`。

## 6. 成功响应

HTTP 200。`success` 表示**通道有没有发出去**，不是续期是否成功。

```json
{
  "success": true,
  "taskId": 12,
  "projectId": "proj_xxx",
  "channels": {
    "email": { "status": "sent", "messageId": "..." },
    "telegram": { "status": "sent", "messageId": "..." }
  },
  "level": "partial",
  "data": { "total": 5, "success": 3, "failed": 2 },
  "timestamp": "2026-08-30T13:40:00.000Z"
}
```

| `channels.*.status` | 含义 |
| --- | --- |
| `sent` | 已发出（含未配 SMTP/Bot 时的 mock） |
| `failed` | 该通道发送失败 |
| `skipped` | 项目没开这个通道，或请求没要这个通道 |

未配 SMTP / Telegram 时仍会 `sent`，`messageId` 类似 `mock_*`，任务会进后台。真发信要在网关**设置**里配齐。

## 7. 失败与限流

| HTTP | 含义 | 续期仓库怎么处理 |
| --- | --- | --- |
| 400 | JSON 坏了，或字段不合法，`errors` 里有字段说明 | 修 payload，不要死循环重试 |
| 401 | 没带 Token，或 Token 错 / 已轮换 | 检查 Secrets，不要狂重试 |
| 403 | 项目在后台被关掉 | 找管理员打开项目 |
| 429 | 限流：同一 IP 约 60 次/分钟，同一项目约 120 次/分钟 | 看 `Retry-After`，稍后重试 |

校验失败示例：

```json
{
  "success": false,
  "error": "validation failed",
  "errors": [{ "field": "title", "message": "title is required" }]
}
```

## 8. 接入时注意

- 每个续期仓库一把 Token。泄漏后在网关项目页重新生成。
- 不要在续期仓库里写 SMTP 密码、Telegram Bot Token、收件人。
- 不要把完整 Token 打进日志或提交进 git。
- `channel` 不能指定收件人，只能选开不开邮件 / Telegram。
- 正文超过 5000 字会被拒，长日志截断或只放摘要，明细放 `data.details`。
- 后台「任务」页能按项目、发送状态、时间筛选，并下载 CSV。对不上就先看这里，再查续期仓库的请求。
