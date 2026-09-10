#!/usr/bin/env node
/**
 * Create KV + D1 when wrangler.toml still has placeholder IDs.
 * Idempotent: reuses namespaces/databases that already exist by name.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TOML_PATH = path.join(process.cwd(), "wrangler.toml");
const KV_TITLE = "notify-projects";
const D1_NAME = "notify-tasks";

export function isPlaceholder(id) {
  if (!id || typeof id !== "string") return true;
  const compact = id.replace(/-/g, "").toLowerCase();
  if (compact.length < 8) return true;
  if (/^0+$/.test(compact)) return true;
  // Local/repo placeholders like ...0001 / ...0002 are not valid CF resources.
  if (/^0+[0-9a-f]{1,2}$/.test(compact)) return true;
  return false;
}

export function isValidD1Id(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "");
}

function wranglerBin() {
  const local = path.join(process.cwd(), "node_modules", ".bin", "wrangler");
  return fs.existsSync(local) ? local : "npx --no-install wrangler";
}

function sh(cmd) {
  console.log(`→ ${cmd}`);
  return execSync(cmd, {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
    },
  });
}

function wrangler(args) {
  return sh(`${wranglerBin()} ${args}`);
}

function extractJson(raw) {
  const text = raw.trim();
  const start = Math.min(
    ...["[", "{"].map((c) => {
      const i = text.indexOf(c);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    }),
  );
  if (!Number.isFinite(start)) throw new Error(`Expected JSON from wrangler:\n${raw}`);
  return JSON.parse(text.slice(start));
}

function findD1(raw) {
  try {
    const listed = asList(extractJson(raw));
    const row = listed.find((item) => item.name === D1_NAME);
    if (row) return row.uuid || row.id;
  } catch {
    /* table output */
  }
  const escaped = D1_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = raw.match(new RegExp(`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}).*${escaped}`, "i"));
  return row?.[1] || null;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.namespaces)) return value.namespaces;
  if (Array.isArray(value?.databases)) return value.databases;
  return [];
}

export function replaceField(toml, section, key, value) {
  const re = new RegExp(`(\\[\\[${section}\\]\\][\\s\\S]*?${key}\\s*=\\s*")[^"]*(")`);
  if (!re.test(toml)) throw new Error(`wrangler.toml missing [[${section}]] ${key}`);
  return toml.replace(re, `$1${value}$2`);
}

export function readIds(toml) {
  return {
    kv: toml.match(/\[\[kv_namespaces\]\][\s\S]*?id\s*=\s*"([^"]+)"/)?.[1],
    d1: toml.match(/\[\[d1_databases\]\][\s\S]*?database_id\s*=\s*"([^"]+)"/)?.[1],
  };
}

export function main() {
  let toml = fs.readFileSync(TOML_PATH, "utf8");
  let { kv, d1 } = readIds(toml);
  kv = process.env.NOTIFY_KV_ID || kv;
  d1 = process.env.NOTIFY_D1_ID || d1;

  if (isPlaceholder(kv)) {
    console.log("Looking up KV namespace notify-projects…");
    const listed = asList(extractJson(wrangler("kv namespace list")));
    const found = listed.find((item) => item.title === KV_TITLE);
    if (found?.id) {
      kv = found.id;
      console.log(`Reusing KV ${KV_TITLE} (${kv})`);
    } else {
      console.log("Creating KV namespace notify-projects…");
      const created = wrangler(`kv namespace create ${KV_TITLE}`);
      kv = created.match(/id\s*=\s*"([^"]+)"/)?.[1];
      if (!kv) throw new Error(`Failed to create KV:\n${created}`);
      console.log(`Created KV ${KV_TITLE} (${kv})`);
    }
  } else {
    console.log(`Keeping existing KV id ${kv}`);
  }

  if (isPlaceholder(d1) || !isValidD1Id(d1)) {
    console.log("Looking up D1 database notify-tasks…");
    let found = findD1(wrangler("d1 list"));
    if (found) {
      d1 = found;
      console.log(`Reusing D1 ${D1_NAME} (${d1})`);
    } else {
      console.log("Creating D1 database notify-tasks…");
      const created = wrangler(`d1 create ${D1_NAME}`);
      d1 = created.match(/database_id\s*=\s*"([^"]+)"/)?.[1] || created.match(/uuid\s*[:=]\s*"?([0-9a-f-]{36})/i)?.[1];
      if (!d1) throw new Error(`Failed to create D1:\n${created}`);
      console.log(`Created D1 ${D1_NAME} (${d1})`);
    }
    if (!isValidD1Id(d1)) {
      throw new Error(`D1 id is still not a UUID after provision: ${d1}`);
    }
  } else {
    console.log(`Keeping existing D1 id ${d1}`);
  }

  toml = replaceField(toml, "kv_namespaces", "id", kv);
  toml = replaceField(toml, "d1_databases", "database_id", d1);
  fs.writeFileSync(TOML_PATH, toml);
  console.log(`Wrote wrangler.toml bindings: NOTIFY_KV=${kv} DB=${d1}`);
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) main();
