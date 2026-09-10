import { describe, expect, it } from "vitest";
import {
  applySettingsPatch,
  emptyStored,
  envFallback,
  publicSettings,
  resolveChannelConfig,
  validateSettingsPatch,
} from "../src/settings";
import type { Env } from "../src/types";
import { sanitizeFromAddress, validSmtpHost, validTelegramChatId } from "../src/validate";

function env(partial: Partial<Env> = {}): Env {
  return partial as Env;
}

describe("resolveChannelConfig", () => {
  it("falls back to Worker secrets when KV is empty", () => {
    const cfg = resolveChannelConfig(
      null,
      env({
        SMTP_HOST: "smtp.env.com",
        SMTP_USER: "env@example.com",
        SMTP_PASSWORD: "env-pass",
        SMTP_TO: "inbox@example.com",
        TELEGRAM_BOT_TOKEN: "token",
        TELEGRAM_CHAT_ID: "99",
      }),
    );
    expect(cfg.smtpReady).toBe(true);
    expect(cfg.telegramReady).toBe(true);
    expect(cfg.smtp.host).toBe("smtp.env.com");
    expect(cfg.smtp.to).toBe("inbox@example.com");
  });

  it("prefers non-empty KV fields over secrets", () => {
    const stored = applySettingsPatch(emptyStored(), {
      smtp: { host: "smtp.kv.com", user: "kv@example.com", password: "kv-pass", to: "you@example.com" },
    });
    const cfg = resolveChannelConfig(
      stored,
      env({ SMTP_HOST: "smtp.env.com", SMTP_USER: "env@example.com", SMTP_PASSWORD: "env-pass" }),
    );
    expect(cfg.smtp.host).toBe("smtp.kv.com");
    expect(cfg.smtp.password).toBe("kv-pass");
    expect(cfg.smtpReady).toBe(true);
  });

  it("keeps env password when KV saved host but never stored a password", () => {
    const stored = applySettingsPatch(emptyStored(), { smtp: { host: "smtp.kv.com", user: "kv@example.com" } });
    expect(stored.smtp.password).toBeUndefined();
    const cfg = resolveChannelConfig(stored, env({ SMTP_PASSWORD: "env-pass" }));
    expect(cfg.smtp.password).toBe("env-pass");
  });

  it("does not fall back to env password after an explicit clear", () => {
    const stored = applySettingsPatch(emptyStored(), { smtp: { password: "kv-pass" } });
    const cleared = applySettingsPatch(stored, { smtp: { clearPassword: true } });
    expect(cleared.smtp.password).toBe("");
    const cfg = resolveChannelConfig(cleared, env({ SMTP_PASSWORD: "env-pass", SMTP_HOST: "h", SMTP_USER: "u" }));
    expect(cfg.smtp.password).toBe("");
    expect(cfg.smtpReady).toBe(false);
  });

  it("changing host does not wipe a stored password", () => {
    const stored = applySettingsPatch(emptyStored(), { smtp: { host: "a.com", password: "keep-me" } });
    const next = applySettingsPatch(stored, { smtp: { host: "b.com", password: "" } });
    expect(next.smtp.host).toBe("b.com");
    expect(next.smtp.password).toBe("keep-me");
  });

  it("is not ready (mock) when nothing is configured", () => {
    const cfg = resolveChannelConfig(null, env());
    expect(cfg.smtpReady).toBe(false);
    expect(cfg.telegramReady).toBe(false);
  });
});

describe("publicSettings", () => {
  it("masks secrets and never returns JWT fields", () => {
    const stored = applySettingsPatch(emptyStored(), {
      smtp: { host: "smtp.kv.com", user: "u@example.com", password: "super-secret-pass" },
      telegram: { botToken: "123456:ABCDEF", chatId: "42" },
    });
    const pub = publicSettings(stored, env({ JWT_SECRET: "should-not-leak" }));
    expect(pub.smtp.password).toContain("••••");
    expect(pub.smtp.password).not.toContain("super-secret-pass");
    expect(pub.telegram.botToken).toContain("••••");
    expect(JSON.stringify(pub)).not.toContain("should-not-leak");
    expect(JSON.stringify(pub)).not.toContain("JWT");
  });
});

describe("validateSettingsPatch", () => {
  it("rejects protocol in SMTP host and bad ports", () => {
    expect(validateSettingsPatch({ smtp: { host: "https://smtp.example.com" } })).toBeTruthy();
    expect(validateSettingsPatch({ smtp: { port: "999" } })).toBeTruthy();
    expect(validateSettingsPatch({ smtp: { host: "smtp.example.com", port: "587" } })).toBeNull();
  });

  it("rejects invalid recipients and telegram chat ids", () => {
    expect(validateSettingsPatch({ smtp: { to: "not-an-email" } })).toBeTruthy();
    expect(validateSettingsPatch({ smtp: { from: "Notify <bad>" } })).toBeTruthy();
    expect(validateSettingsPatch({ telegram: { chatId: "abc" } })).toBeTruthy();
    expect(validateSettingsPatch({ telegram: { chatId: "-100123" } })).toBeNull();
  });
});

describe("helpers", () => {
  it("accepts From display names and telegram numeric ids", () => {
    expect(sanitizeFromAddress("Notify Gateway <you@example.com>")).toBe("Notify Gateway <you@example.com>");
    expect(validSmtpHost("smtp.gmail.com")).toBe(true);
    expect(validSmtpHost("smtp.gmail.com/evil")).toBe(false);
    expect(validTelegramChatId("-1001")).toBe(true);
  });

  it("envFallback copies only channel secrets, not JWT", () => {
    const fb = envFallback(env({ JWT_SECRET: "jwt", SMTP_HOST: "h", TELEGRAM_CHAT_ID: "1" }));
    expect(fb.smtp.host).toBe("h");
    expect(JSON.stringify(fb)).not.toContain("jwt");
  });
});
