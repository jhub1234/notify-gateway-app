import { describe, expect, it } from "vitest";
import { buildNotifyUrl, validatePublicHost } from "../src/notify-url";

describe("buildNotifyUrl", () => {
  it("completes a bare domain", () => {
    expect(buildNotifyUrl("example.com")).toBe("https://example.com/api/notify");
    expect(buildNotifyUrl("notify.example.com")).toBe("https://notify.example.com/api/notify");
  });

  it("keeps http(s) and strips extra path", () => {
    expect(buildNotifyUrl("https://example.com")).toBe("https://example.com/api/notify");
    expect(buildNotifyUrl("https://example.com/")).toBe("https://example.com/api/notify");
    expect(buildNotifyUrl("https://example.com/api/notify")).toBe("https://example.com/api/notify");
    expect(buildNotifyUrl("http://127.0.0.1:43147")).toBe("http://127.0.0.1:43147/api/notify");
  });

  it("falls back to the current origin when domain is empty", () => {
    expect(buildNotifyUrl("", "https://notify-gateway.example.workers.dev")).toBe(
      "https://notify-gateway.example.workers.dev/api/notify",
    );
  });

  it("rejects junk", () => {
    expect(buildNotifyUrl("https://")).toBe("");
    expect(buildNotifyUrl("not a host")).toBe("");
    expect(buildNotifyUrl("localhost")).toBe("https://localhost/api/notify");
    expect(validatePublicHost("example.com")).toBeNull();
    expect(validatePublicHost("")).toBeNull();
    expect(validatePublicHost("https://example.com/api/notify")).toBeNull();
    expect(validatePublicHost("no spaces allowed.com")).toBeTruthy();
  });
});
