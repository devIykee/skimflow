/**
 * Transactional email via Resend. All sends go through sendEmail() — never throw
 * into callers; failures are logged only.
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_EMAIL.
 * Links use NEXT_PUBLIC_APP_URL.
 */
import { marked } from "marked";
import { Resend } from "resend";

const ACCENT = "#FF9B73";
const BG = "#0a0a0a";
const TEXT = "#ffffff";
const MUTED = "#a1a1aa";

let warnedNoProvider = false;

function getApiKey(): string | undefined {
  return process.env.RESEND_API_KEY?.trim() || undefined;
}

function getFromEmail(): string | undefined {
  return process.env.RESEND_FROM_EMAIL?.trim() || undefined;
}

/** Resend `from` — display name + verified address. */
function formatFrom(): string | undefined {
  const addr = getFromEmail();
  if (!addr) return undefined;
  if (/^[^<]+<.+>$/.test(addr)) return addr;
  return `Skimflow <${addr}>`;
}

export function emailProviderStatus(): { configured: boolean; from?: string; missing: string[] } {
  const missing: string[] = [];
  if (!getApiKey()) missing.push("RESEND_API_KEY");
  if (!getFromEmail()) missing.push("RESEND_FROM_EMAIL");
  return { configured: missing.length === 0, from: getFromEmail(), missing };
}

function warnMissingProvider(): void {
  if (warnedNoProvider) return;
  warnedNoProvider = true;
  if (!getApiKey()) {
    console.warn("⚠️ RESEND_API_KEY not set — skipping all email sends.");
  } else if (!getFromEmail()) {
    console.warn("⚠️ RESEND_FROM_EMAIL not set — skipping all email sends.");
  }
}

/** Configured Resend client (null when RESEND_API_KEY is absent). */
export const resend: Resend | null = getApiKey() ? new Resend(getApiKey()!) : null;

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export interface EmailRecipient {
  email: string;
  name?: string | null;
  display_name?: string | null;
  handle?: string | null;
}

function capitalizeWord(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function firstNameFromFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return capitalizeWord(trimmed.split(/\s+/)[0] ?? trimmed);
}

function emailLocalPart(email: string): string {
  return email.split("@")[0]?.split("+")[0]?.trim().toLowerCase() ?? "";
}

/** True when a string looks like a handle/username, not a person's name. */
function looksLikeHandle(value: string, handle?: string | null): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  if (handle && v === handle.trim().toLowerCase()) return true;
  // ada_writes_x7k2 — slug + random suffix from signup
  if (/^[a-z0-9]+(_[a-z0-9]+){1,}$/.test(v)) return true;
  if (v.includes("_") && !v.includes(" ")) return true;
  return false;
}

/** Auto-generated display_name copied from the email prefix (eniolaomojolowo@gmail.com). */
function isEmailLocalSlug(value: string, email: string): boolean {
  const v = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const local = emailLocalPart(email).replace(/[^a-z0-9]/g, "");
  if (!v || !local || value.includes(" ")) return false;
  return v === local;
}

/** Only when the address is clearly first.last@ or first_last@ — not one blob. */
function firstNameFromEmail(email: string): string | null {
  const local = emailLocalPart(email);
  if (!local) return null;
  const parts = local.split(/[._-]/).filter((p) => p.length >= 2 && !/^\d+$/.test(p));
  if (parts.length < 2) return null;
  return capitalizeWord(parts[0]);
}

/**
 * Best-effort first name for email greetings.
 * Prefers OAuth `name` with a space (e.g. "Eniola Omojolowo" → Eniola).
 */
export function emailGreetingName(user: EmailRecipient): string {
  const oauthName = user.name?.trim();
  if (oauthName?.includes(" ") && !looksLikeHandle(oauthName, user.handle)) {
    return firstNameFromFullName(oauthName);
  }

  const display = user.display_name?.trim();
  if (
    display &&
    !looksLikeHandle(display, user.handle) &&
    !isEmailLocalSlug(display, user.email) &&
    (display.includes(" ") || /^[A-Z][a-z]{1,31}$/.test(display))
  ) {
    return firstNameFromFullName(display);
  }

  if (oauthName && !looksLikeHandle(oauthName, user.handle) && !isEmailLocalSlug(oauthName, user.email)) {
    return firstNameFromFullName(oauthName);
  }

  if (display && !looksLikeHandle(display, user.handle) && !isEmailLocalSlug(display, user.email)) {
    return firstNameFromFullName(display);
  }

  const fromEmail = firstNameFromEmail(user.email);
  if (fromEmail) return fromEmail;

  return "there";
}

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function emailShell(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:32px 16px;background:${BG};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;color:${TEXT};">
    ${body}
  </div>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<p style="margin:28px 0 0;">
    <a href="${href}" style="display:inline-block;background:${ACCENT};color:#0a0a0a;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;">${label}</a>
  </p>`;
}

function footer(text: string): string {
  return `<p style="margin:32px 0 0;padding-top:24px;border-top:1px solid #27272a;color:${MUTED};font-size:12px;line-height:1.5;">${text}</p>`;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
}

function sanitizeRenderedHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on\w+="[^"]*"/gi, "")
    .replace(/javascript:/gi, "");
}

let markdownReady = false;

/** Configure marked once — dark-theme inline styles for email clients. */
function ensureMarkdownParser(): void {
  if (markdownReady) return;
  const linkStyle = `color:${ACCENT};text-decoration:underline;`;
  const textStyle = `color:${TEXT};`;
  const mutedStyle = `color:${MUTED};`;

  marked.use({
    gfm: true,
    breaks: true,
    renderer: {
      html({ text }) {
        return escapeHtml(text);
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const sizes: Record<number, string> = {
          1: "22px",
          2: "18px",
          3: "16px",
          4: "15px",
          5: "14px",
          6: "14px",
        };
        const size = sizes[depth] ?? "16px";
        const margin = depth <= 2 ? "24px 0 12px" : "18px 0 8px";
        return `<h${depth} style="margin:${margin};font-size:${size};font-weight:600;line-height:1.3;${textStyle}">${inner}</h${depth}>`;
      },
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        return `<p style="margin:0 0 16px;line-height:1.7;${textStyle}">${inner}</p>`;
      },
      strong({ tokens }) {
        return `<strong style="font-weight:600;${textStyle}">${this.parser.parseInline(tokens)}</strong>`;
      },
      em({ tokens }) {
        return `<em style="font-style:italic;${textStyle}">${this.parser.parseInline(tokens)}</em>`;
      },
      del({ tokens }) {
        return `<del style="${mutedStyle}">${this.parser.parseInline(tokens)}</del>`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const safe = safeHref(href ?? "");
        if (!safe) return inner;
        return `<a href="${safe}" style="${linkStyle}">${inner}</a>`;
      },
      codespan({ text }) {
        return `<code style="font-family:ui-monospace,monospace;font-size:0.9em;background:#27272a;padding:2px 6px;border-radius:4px;${textStyle}">${escapeHtml(text)}</code>`;
      },
      code({ text, lang }) {
        void lang;
        return `<pre style="margin:0 0 16px;padding:16px;background:#18181b;border-radius:8px;overflow-x:auto;font-family:ui-monospace,monospace;font-size:13px;line-height:1.5;${textStyle}"><code>${escapeHtml(text)}</code></pre>`;
      },
      blockquote({ tokens }) {
        const inner = this.parser.parse(tokens);
        return `<blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid ${ACCENT};${mutedStyle}">${inner}</blockquote>`;
      },
      hr() {
        return `<hr style="border:none;border-top:1px solid #27272a;margin:24px 0;"/>`;
      },
      list(token) {
        const tag = token.ordered ? "ol" : "ul";
        const inner = token.items.map((item) => this.listitem(item)).join("");
        const spacing = token.ordered ? "padding-left:24px;" : "padding-left:20px;";
        return `<${tag} style="margin:0 0 16px;${spacing}line-height:1.7;${textStyle}">${inner}</${tag}>`;
      },
      listitem(item) {
        const inner = this.parser.parse(item.tokens);
        return `<li style="margin:0 0 8px;">${inner}</li>`;
      },
      image({ href, title, text }) {
        const safe = safeHref(href ?? "");
        if (!safe) return escapeHtml(text);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<p style="margin:0 0 16px;"><img src="${safe}" alt="${escapeHtml(text)}"${titleAttr} style="max-width:100%;border-radius:8px;"/></p>`;
      },
    },
  });
  markdownReady = true;
}

function markdownBodyToHtml(body: string): string {
  ensureMarkdownParser();
  const raw = marked.parse(body.trim()) as string;
  return sanitizeRenderedHtml(raw);
}

/** Wraps Resend send — logs success/failure, never throws. */
export async function sendEmail(opts: SendOpts): Promise<SendEmailResult> {
  const from = formatFrom();
  const key = getApiKey();
  if (!key || !from) {
    warnMissingProvider();
    const missing = emailProviderStatus().missing.join(", ") || "RESEND_API_KEY, RESEND_FROM_EMAIL";
    return { ok: false, error: `Email not configured in this environment (missing: ${missing})` };
  }

  try {
    const client = resend ?? new Resend(key);
    const { data, error } = await client.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (error) {
      console.error(`[email] failed to send "${opts.subject}" to ${opts.to}:`, error.message);
      return { ok: false, error: error.message };
    }
    console.log(`[email] sent "${opts.subject}" to ${opts.to} (id: ${data?.id ?? "unknown"})`);
    return { ok: true, id: data?.id };
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    console.error(`[email] failed to send "${opts.subject}" to ${opts.to}:`, message);
    return { ok: false, error: message };
  }
}

export async function sendWelcomeEmail(recipient: EmailRecipient): Promise<void> {
  const name = emailGreetingName(recipient);
  const dashboardUrl = `${appUrl()}/dashboard`;
  const html = emailShell(`
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:600;line-height:1.3;">Welcome to Skimflow, ${name} 👋</h1>
    <p style="margin:0 0 20px;color:${MUTED};font-size:16px;line-height:1.6;">
      Skimflow lets you earn USDC every time someone reads a block of your content — no subscriptions, just readers paying for what they actually read.
    </p>
    <ul style="margin:0;padding:0 0 0 20px;color:${TEXT};font-size:15px;line-height:1.8;">
      <li>Your wallet is ready — you can start earning immediately</li>
      <li>Write your first post from your dashboard</li>
      <li>Readers pay per block, you keep 80% of every unlock</li>
    </ul>
    ${ctaButton(dashboardUrl, "Go to your dashboard")}
    ${footer("You're receiving this because you signed up for Skimflow.")}
  `);
  const text = `Welcome to Skimflow, ${name}!\n\nSkimflow lets you earn USDC every time someone reads a block of your content.\n\nGo to your dashboard: ${dashboardUrl}\n\nYou're receiving this because you signed up for Skimflow.`;
  await sendEmail({ to: recipient.email, subject: `Welcome to Skimflow, ${name} 👋`, html, text });
}

export async function sendPayoutNotification(data: {
  creator: EmailRecipient;
  amount: string;
  txHash: string;
  walletAddress: string;
}): Promise<void> {
  const name = emailGreetingName(data.creator);
  const dashboardUrl = `${appUrl()}/dashboard`;
  const txShort = truncateAddr(data.txHash);
  const walletShort = truncateAddr(data.walletAddress);
  const explorerUrl = `https://explorer.arc.net/tx/${data.txHash}`;

  const html = emailShell(`
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;line-height:1.3;">Your payout is on its way, ${name}.</h1>
    <p style="margin:24px 0 8px;color:${MUTED};font-size:14px;">Amount received</p>
    <p style="margin:0;font-size:36px;font-weight:700;color:${ACCENT};line-height:1.2;">${data.amount} USDC</p>
    <table style="margin:28px 0 0;width:100%;border-collapse:collapse;font-size:14px;line-height:1.6;">
      <tr>
        <td style="padding:8px 0;color:${MUTED};vertical-align:top;width:140px;">Transaction</td>
        <td style="padding:8px 0;color:${TEXT};">
          <a href="${explorerUrl}" style="color:${ACCENT};text-decoration:none;font-family:ui-monospace,monospace;">${txShort}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:${MUTED};vertical-align:top;">Wallet</td>
        <td style="padding:8px 0;color:${TEXT};font-family:ui-monospace,monospace;">${walletShort}</td>
      </tr>
    </table>
    <p style="margin:20px 0 0;color:${MUTED};font-size:14px;line-height:1.5;">Settled on Arc Testnet in USDC via Circle.</p>
    ${ctaButton(dashboardUrl, "View your earnings")}
    ${footer("You're receiving this because you're a creator on Skimflow.")}
  `);

  const text = `Your payout is on its way, ${name}.\n\nAmount: ${data.amount} USDC\nTransaction: ${explorerUrl}\nWallet: ${data.walletAddress}\n\nSettled on Arc Testnet in USDC via Circle.\n\nView your earnings: ${dashboardUrl}\n\nYou're receiving this because you're a creator on Skimflow.`;

  await sendEmail({
    to: data.creator.email,
    subject: `You received ${data.amount} USDC 💰`,
    html,
    text,
  });
}

function buildAdminMessagePayload(args: {
  recipient: EmailRecipient;
  subject: string;
  body: string;
}): SendOpts {
  const greeting = emailGreetingName(args.recipient);
  const html = emailShell(`
    <p style="margin:0 0 16px;color:${MUTED};font-size:14px;">Hello ${escapeHtml(greeting)},</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;line-height:1.3;">${escapeHtml(args.subject)}</h1>
    <div style="font-size:16px;line-height:1.7;color:${TEXT};">${markdownBodyToHtml(args.body)}</div>
    ${footer("You're receiving this from Skimflow.")}
  `);
  return {
    to: args.recipient.email,
    subject: args.subject,
    html,
    text: `Hello ${greeting},\n\n${args.subject}\n\n${args.body}\n\nYou're receiving this from Skimflow.`,
  };
}

/** Custom message from admin — same dark template as transactional emails. */
export async function sendAdminMessage(args: {
  recipient: EmailRecipient;
  subject: string;
  body: string;
}): Promise<SendEmailResult> {
  return sendEmail(buildAdminMessagePayload(args));
}

export interface BroadcastResult {
  sent: number;
  failed: number;
  errors: string[];
  errorSummary?: string;
}

const RESEND_BATCH_MAX = 100;
const RATE_LIMIT_PAUSE_MS = 1_100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resendErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "batch_send_failed";
  const e = error as { message?: string; name?: string };
  return e.message ?? e.name ?? "batch_send_failed";
}

/** Resend batch success payload is `{ data: { id }[] }`; the SDK wraps that in `.data`. */
function batchResultIds(data: unknown): string[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map((row) => (row as { id?: string })?.id).filter((id): id is string => !!id);
  }
  if (typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    return ((data as { data: Array<{ id?: string }> }).data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => !!id);
  }
  return [];
}

/**
 * Broadcast admin messages via Resend's batch API (1 HTTP request per ≤100 recipients).
 * Avoids the 10-requests/second limit that parallel single sends hit.
 */
export async function sendAdminBroadcast(
  recipients: EmailRecipient[],
  subject: string,
  body: string
): Promise<BroadcastResult> {
  const from = formatFrom();
  const key = getApiKey();
  if (!key || !from) {
    warnMissingProvider();
    const missing = emailProviderStatus().missing.join(", ") || "RESEND_API_KEY, RESEND_FROM_EMAIL";
    const msg = `Email not configured (missing: ${missing})`;
    return { sent: 0, failed: recipients.length, errors: [msg], errorSummary: msg };
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  const errorCounts = new Map<string, number>();
  const client = resend ?? new Resend(key);

  for (let i = 0; i < recipients.length; i += RESEND_BATCH_MAX) {
    const chunk = recipients.slice(i, i + RESEND_BATCH_MAX);
    const payloads = chunk.map((r) => {
      const msg = buildAdminMessagePayload({ recipient: r, subject, body });
      return { from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text };
    });

    let attempt = 0;
    let done = false;
    while (!done && attempt < 2) {
      attempt++;
      const { data, error } = await client.batch.send(payloads);
      const ids = batchResultIds(data);
      if (!error && ids.length > 0) {
        sent += ids.length;
        if (ids.length < chunk.length) {
          const shortfall = chunk.length - ids.length;
          failed += shortfall;
          const reason = "batch returned fewer ids than recipients";
          errorCounts.set(reason, (errorCounts.get(reason) ?? 0) + shortfall);
        }
        done = true;
        continue;
      }
      const reason = error ? resendErrorMessage(error) : "batch returned no message ids";
      const isRateLimit = /too many requests/i.test(reason);
      if (isRateLimit && attempt < 2) {
        await sleep(RATE_LIMIT_PAUSE_MS);
        continue;
      }
      failed += chunk.length;
      errorCounts.set(reason, (errorCounts.get(reason) ?? 0) + chunk.length);
      if (errors.length < 5) {
        for (const r of chunk.slice(0, 5 - errors.length)) {
          errors.push(`${r.email}: ${reason}`);
        }
      }
      done = true;
    }

    if (i + RESEND_BATCH_MAX < recipients.length) await sleep(RATE_LIMIT_PAUSE_MS);
  }

  const topError = [...errorCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    sent,
    failed,
    errors,
    errorSummary: topError ? `${topError[1]}× ${topError[0]}` : undefined,
  };
}