import { connect } from "cloudflare:sockets";
import type { SmtpConfig } from "../settings";
import type { ChannelResult, NotifyPayload } from "../types";
import { withRetry } from "../rate-limit";
import { emailHtml, emailSubject, emailText } from "./format";

export async function sendEmail(smtp: SmtpConfig, ready: boolean, payload: NotifyPayload): Promise<ChannelResult> {
  if (!ready) {
    return {
      status: "sent",
      messageId: `mock_email_${crypto.randomUUID()}`,
      mock: true,
    };
  }

  const mail = {
    from: smtp.from || smtp.user,
    to: smtp.to || smtp.user,
    subject: emailSubject(payload),
    text: emailText(payload),
    html: emailHtml(payload),
  };

  return withRetry(async () => {
    const messageId = await withTimeout(smtpSend(smtp, mail), 8000, "SMTP timeout");
    return { status: "sent" as const, messageId };
  }, 2, 200).catch((err: unknown) => ({
    status: "failed" as const,
    error: err instanceof Error ? err.message : String(err),
  }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

interface Mail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function smtpSend(smtp: SmtpConfig, mail: Mail): Promise<string> {
  const host = smtp.host;
  const port = Number(smtp.port || "587");
  const secure = port === 465;
  const socket = connect(
    { hostname: host, port },
    { secureTransport: secure ? "on" : "starttls", allowHalfOpen: false },
  );

  const reader = socket.readable.getReader();
  let writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = "";

  const readLine = async (): Promise<string> => {
    while (true) {
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed");
      buffer += decoder.decode(value, { stream: true });
    }
  };

  const readCode = async (): Promise<{ code: number; text: string }> => {
    const lines: string[] = [];
    while (true) {
      const line = await readLine();
      lines.push(line);
      const code = Number(line.slice(0, 3));
      if (!Number.isFinite(code)) throw new Error(`Bad SMTP line: ${line}`);
      if (line[3] === " ") return { code, text: lines.join("\n") };
    }
  };

  const expect = async (ok: number[]) => {
    const res = await readCode();
    if (!ok.includes(res.code)) throw new Error(`SMTP ${res.text}`);
    return res;
  };

  const send = async (line: string) => {
    await writer.write(new TextEncoder().encode(line + "\r\n"));
  };

  try {
    await expect([220]);
    await send(`EHLO notify-gateway`);
    await expect([250]);

    if (!secure) {
      await send("STARTTLS");
      await expect([220]);
      writer.releaseLock();
      const tls = socket.startTls();
      writer = tls.writable.getWriter();
      await send(`EHLO notify-gateway`);
      await expect([250]);
    }

    await send("AUTH LOGIN");
    await expect([334]);
    await send(b64(smtp.user));
    await expect([334]);
    await send(b64(smtp.password));
    await expect([235]);

    await send(`MAIL FROM:<${extractAddr(mail.from)}>`);
    await expect([250]);
    await send(`RCPT TO:<${extractAddr(mail.to)}>`);
    await expect([250, 251]);
    await send("DATA");
    await expect([354]);

    const messageId = `<${crypto.randomUUID()}@notify-gateway>`;
    const body = buildMime(mail, messageId);
    await writer.write(new TextEncoder().encode(body.replace(/\n/g, "\r\n") + "\r\n.\r\n"));
    await expect([250]);
    await send("QUIT");
    return messageId;
  } finally {
    try {
      writer.releaseLock();
      reader.releaseLock();
      socket.close();
    } catch {
      /* ignore */
    }
  }
}

function b64(value: string): string {
  return btoa(value);
}

function extractAddr(value: string): string {
  const m = value.match(/<([^>]+)>/);
  return m ? m[1] : value;
}

function buildMime(mail: Mail, messageId: string): string {
  const boundary = `ng_${crypto.randomUUID().replace(/-/g, "")}`;
  return [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeSubject(mail.subject)}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.html,
    `--${boundary}--`,
    "",
  ].join("\n");
}

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
}
