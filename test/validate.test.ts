import { describe, expect, it } from "vitest";
import {
  assertProjectId,
  assertTaskId,
  deriveSendStatus,
  escapeCsv,
  intersectChannels,
  isSafePathSegment,
  parseIsoDate,
  sanitizeEmail,
  validateNotifyPayload,
  validatePassword,
} from "../src/validate";

describe("channel intersection", () => {
  it("keeps only channels enabled on the project", () => {
    expect(intersectChannels(["email", "telegram"], ["email"])).toEqual(["email"]);
  });

  it("defaults to project channels when request omits them", () => {
    expect(intersectChannels(undefined, ["telegram"])).toEqual(["telegram"]);
  });

  it("can produce an empty intersection when project closed a channel", () => {
    expect(intersectChannels(["telegram"], ["email"])).toEqual([]);
  });
});

describe("send status", () => {
  it("marks mixed channel outcomes as partial", () => {
    expect(deriveSendStatus({ email: "sent", telegram: "failed" })).toBe("partial");
  });

  it("is sent only when every active channel sent", () => {
    expect(deriveSendStatus({ email: "sent", telegram: "sent" })).toBe("sent");
  });

  it("ignores skipped channels", () => {
    expect(deriveSendStatus({ email: "sent", telegram: "skipped" })).toBe("sent");
  });

  it("is failed when all active channels fail", () => {
    expect(deriveSendStatus({ email: "failed", telegram: "failed" })).toBe("failed");
  });
});

describe("notify payload", () => {
  const base = {
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
        { id: "site_001", name: "Site C", status: "partial", message: "1/2 续期成功" },
      ],
    },
  };

  it("accepts the documented structured payload", () => {
    const parsed = validateNotifyPayload(base);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.level).toBe("partial");
      expect(parsed.value.data.details).toHaveLength(3);
    }
  });

  it("rejects content longer than 5000 characters", () => {
    const parsed = validateNotifyPayload({ ...base, content: "x".repeat(5001) });
    expect(parsed.ok).toBe(false);
  });

  it("rejects unknown account statuses", () => {
    const parsed = validateNotifyPayload({
      ...base,
      data: { details: [{ id: "1", name: "A", status: "boom" }] },
    });
    expect(parsed.ok).toBe(false);
  });
});

describe("security helpers", () => {
  it("blocks path traversal segments", () => {
    expect(isSafePathSegment("../etc/passwd")).toBe(false);
    expect(isSafePathSegment("prj_abc/../x")).toBe(false);
    expect(assertProjectId("../secret")).toBe(false);
    expect(assertTaskId("1; DROP TABLE tasks")).toBe(false);
    expect(assertProjectId("prj_0123456789abcdef0123")).toBe(true);
    expect(assertTaskId("42")).toBe(true);
  });

  it("validates admin email and password", () => {
    expect(sanitizeEmail("Admin@Example.COM")).toBe("admin@example.com");
    expect(sanitizeEmail("not-an-email")).toBeNull();
    expect(validatePassword("short")).toBeTruthy();
    expect(validatePassword("long-enough")).toBeNull();
  });

  it("escapes CSV injection-prone fields", () => {
    expect(escapeCsv('say "hi", please')).toBe('"say ""hi"", please"');
  });

  it("accepts only ISO-like date filters", () => {
    expect(parseIsoDate("2026-08-29")).toBeTruthy();
    expect(parseIsoDate("yesterday")).toBeNull();
  });
});
