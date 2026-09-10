import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { isPlaceholder, isValidD1Id, readIds, replaceField } from "../scripts/ensure-cf-resources.mjs";

const root = process.cwd();

describe("placeholder IDs", () => {
  it("treats repo placeholders as unset so CI creates real KV/D1", () => {
    expect(isPlaceholder("00000000000000000000000000000000")).toBe(true);
    expect(isPlaceholder("00000000000000000000000000000001")).toBe(true);
    expect(isPlaceholder("00000000000000000000000000000002")).toBe(true);
    expect(isPlaceholder("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isPlaceholder("")).toBe(true);
    expect(isValidD1Id("00000000000000000000000000000002")).toBe(false);
    expect(isPlaceholder("a1b2c3d4e5f67890123456789abcdeff")).toBe(false);
    expect(isValidD1Id("11111111-2222-4333-a444-555555555555")).toBe(true);
  });

  it("rewrites only the D1 database_id when provisioning", () => {
    const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
    const next = replaceField(toml, "d1_databases", "database_id", "11111111-2222-4333-a444-555555555555");
    expect(readIds(next).d1).toBe("11111111-2222-4333-a444-555555555555");
    expect(isPlaceholder(readIds(toml).d1)).toBe(true);
  });
});

describe("cloudflare deploy wiring", () => {
  it("keeps placeholder resource IDs so the deploy button can provision them", () => {
    const toml = readFileSync(join(root, "wrangler.toml"), "utf8");
    expect(toml).toMatch(/id = "00000000000000000000000000000000"/);
    expect(toml).toMatch(/database_id = "00000000-0000-0000-0000-000000000000"/);
    expect(toml).toMatch(/migrations_dir = "migrations"/);
    expect(toml).toMatch(/binding = "NOTIFY_KV"/);
    expect(toml).toMatch(/binding = "DB"/);
  });

  it("applies D1 migrations by binding name in deploy scripts", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
      cloudflare: { bindings: Record<string, { description: string }> };
    };
    expect(pkg.scripts.deploy).toContain("db:migrate");
    expect(pkg.scripts["db:migrate"]).toBe("wrangler d1 migrations apply notify-tasks --remote");
    expect(pkg.cloudflare.bindings.JWT_SECRET.description).toBeTruthy();
    expect(pkg.cloudflare.bindings.KEY_HMAC_SECRET.description).toBeTruthy();
  });

  it("ships a GitHub Actions deploy workflow", () => {
    const yml = readFileSync(join(root, ".github/workflows/deploy.yml"), "utf8");
    expect(yml).toContain("cloudflare/wrangler-action@v3");
    expect(yml).toContain("ensure-cf-resources.mjs");
    expect(yml).toContain("migrations apply notify-tasks --remote");
    expect(yml).not.toContain("--yes");
    expect(yml).toContain("JWT_SECRET");
    expect(yml).toContain("KEY_HMAC_SECRET");
  });
});
