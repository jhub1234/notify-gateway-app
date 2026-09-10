import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, hashPassword, signJwt, verifyJwt, verifyPassword } from "../src/crypto";

describe("keys and passwords", () => {
  it("hashes API keys with HMAC-SHA256 so two projects cannot share a lookup", async () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
    const ha = await hashApiKey("secret-a", a);
    const hb = await hashApiKey("secret-a", b);
    const other = await hashApiKey("secret-b", a);
    expect(ha).not.toBe(hb);
    expect(ha).not.toBe(other);
    expect(ha).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies PBKDF2 password hashes", async () => {
    const stored = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", stored)).toBe(true);
    expect(await verifyPassword("wrong-battery", stored)).toBe(false);
  });

  it("round-trips JWT sessions and rejects tampering", async () => {
    const token = await signJwt("jwt-secret-value", {
      sub: "admin@example.com",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const ok = await verifyJwt<{ sub: string }>("jwt-secret-value", token);
    expect(ok?.sub).toBe("admin@example.com");
    const bad = await verifyJwt("other-secret-value", token);
    expect(bad).toBeNull();
  });
});
