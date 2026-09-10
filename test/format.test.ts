import { describe, expect, it } from "vitest";
import { emailSubject, emailText, telegramText } from "../src/channels/format";
import type { NotifyPayload } from "../src/types";

const payload: NotifyPayload = {
  source: "puratya-renew",
  title: "MWS 续期完成",
  content: "续期完成报告",
  level: "partial",
  channel: ["email", "telegram"],
  data: {
    total: 5,
    success: 3,
    failed: 2,
    details: [
      { id: "bot_001", name: "Bot A", status: "success" },
      { id: "bot_002", name: "Bot B", status: "failed", error: "HTTP 403" },
    ],
  },
};

describe("message formatters", () => {
  it("builds a source-prefixed subject", () => {
    expect(emailSubject(payload)).toBe("[puratya-renew] MWS 续期完成");
  });

  it("includes mixed account outcomes in text bodies", () => {
    expect(emailText(payload)).toContain("Bot B");
    expect(emailText(payload)).toContain("HTTP 403");
    expect(telegramText(payload)).toContain("[partial]");
    expect(telegramText(payload)).toContain("成功 3");
  });
});
