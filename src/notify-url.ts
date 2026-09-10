const NOTIFY_PATH = "/api/notify";

/** Accept example.com, https://example.com, or a full notify URL. Always emit https?://host/api/notify. */
export function buildNotifyUrl(input: string, fallbackOrigin = ""): string {
  const raw = (input || fallbackOrigin || "").trim();
  if (!raw || /\s/.test(raw)) return "";
  let host = raw.replace(/\/+$/, "").replace(/\/api\/notify$/i, "");
  if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
  try {
    const url = new URL(host);
    if (!usableHostname(url.hostname) || url.username || url.password) return "";
    return `${url.protocol}//${url.host}${NOTIFY_PATH}`;
  } catch {
    return "";
  }
}

function usableHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  return (
    hostname.includes(".") &&
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)
  );
}

export function validatePublicHost(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/\s/.test(value)) return "对外域名不能包含空格";
  if (!buildNotifyUrl(value)) return "对外域名格式不正确，填 example.com 即可";
  return null;
}
