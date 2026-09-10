import type { TelegramConfig } from "../settings";
import type { ChannelResult, NotifyPayload } from "../types";
import { withRetry } from "../rate-limit";
import { telegramText } from "./format";

export async function sendTelegram(
  telegram: TelegramConfig,
  ready: boolean,
  payload: NotifyPayload,
): Promise<ChannelResult> {
  if (!ready) {
    return {
      status: "sent",
      messageId: `mock_tg_${crypto.randomUUID()}`,
      mock: true,
    };
  }

  return withRetry(async () => {
    const url = `https://api.telegram.org/bot${telegram.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegram.chatId,
        text: telegramText(payload),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!res.ok || !body.ok) {
      throw new Error(body.description || `Telegram HTTP ${res.status}`);
    }
    return { status: "sent" as const, messageId: String(body.result?.message_id ?? "") };
  }).catch((err: unknown) => ({
    status: "failed" as const,
    error: err instanceof Error ? err.message : String(err),
  }));
}
