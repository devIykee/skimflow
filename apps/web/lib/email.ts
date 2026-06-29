/**
 * Transactional email via Resend. All sends go through sendEmail() — never throw
 * into callers; failures are logged only.
 *
 * Required env: RESEND_API_KEY, RESEND_FROM_EMAIL.
 * Links use NEXT_PUBLIC_APP_URL.
 */
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

function firstName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
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

function bodyToHtml(body: string): string {
  // Markdown links: [link text](https://example.com)
  let html = escapeHtml(body).replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, url: string) => {
      const href = safeHref(url);
      if (!href) return _match;
      return `<a href="${href}" style="color:${ACCENT};text-decoration:underline;">${label}</a>`;
    }
  );
  // Bare URLs become clickable when not already part of a markdown link.
  html = html.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (match, prefix: string, url: string) => {
    const href = safeHref(url.replace(/[.,;:!?)]+$/, ""));
    if (!href) return match;
    const trailing = url.slice(href.length);
    return `${prefix}<a href="${href}" style="color:${ACCENT};text-decoration:underline;">${href}</a>${escapeHtml(trailing)}`;
  });
  return html.replace(/\n/g, "<br/>");
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

export async function sendWelcomeEmail(user: { name: string; email: string }): Promise<void> {
  const name = firstName(user.name);
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
  await sendEmail({ to: user.email, subject: `Welcome to Skimflow, ${name} 👋`, html, text });
}

export async function sendPayoutNotification(data: {
  creatorName: string;
  creatorEmail: string;
  amount: string;
  txHash: string;
  walletAddress: string;
}): Promise<void> {
  const name = firstName(data.creatorName);
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
    to: data.creatorEmail,
    subject: `You received ${data.amount} USDC 💰`,
    html,
    text,
  });
}

/** Custom message from admin — same dark template as transactional emails. */
export async function sendAdminMessage(args: {
  to: string;
  name?: string;
  subject: string;
  body: string;
}): Promise<SendEmailResult> {
  const greeting = firstName(args.name ?? "there");
  const html = emailShell(`
    <p style="margin:0 0 16px;color:${MUTED};font-size:14px;">Hi ${escapeHtml(greeting)},</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;line-height:1.3;">${escapeHtml(args.subject)}</h1>
    <div style="font-size:16px;line-height:1.7;color:${TEXT};">${bodyToHtml(args.body)}</div>
    ${footer("You're receiving this from Skimflow.")}
  `);
  return sendEmail({
    to: args.to,
    subject: args.subject,
    html,
    text: `Hi ${greeting},\n\n${args.subject}\n\n${args.body}\n\nYou're receiving this from Skimflow.`,
  });
}