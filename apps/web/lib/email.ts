/**
 * Transactional email. Resend is the default provider; Postmark is the
 * fallback (used when RESEND_API_KEY is absent but POSTMARK_API_KEY is set).
 * Both are called over their REST APIs via fetch — no SDK dependency.
 *
 * EVERY send is fire-and-forget: `dispatch()` schedules the request and returns
 * immediately, so a payment response is NEVER blocked on email delivery. Errors
 * are logged, never thrown into the caller.
 *
 * Required env: EMAIL_FROM, and one of RESEND_API_KEY / POSTMARK_API_KEY.
 */
interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let warnedNoProvider = false;

async function sendNow(opts: SendOpts): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    if (!warnedNoProvider) {
      console.warn("⚠️ EMAIL_FROM not set — skipping email delivery.");
      warnedNoProvider = true;
    }
    return;
  }

  const resendKey = process.env.RESEND_API_KEY;
  const postmarkKey = process.env.POSTMARK_API_KEY;

  if (resendKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    return;
  }

  if (postmarkKey) {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": postmarkKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        From: from,
        To: opts.to,
        Subject: opts.subject,
        HtmlBody: opts.html,
        TextBody: opts.text ?? opts.html.replace(/<[^>]+>/g, ""),
        MessageStream: "outbound",
      }),
    });
    if (!res.ok) throw new Error(`postmark ${res.status}: ${await res.text()}`);
    return;
  }

  if (!warnedNoProvider) {
    console.warn(
      "⚠️ No email provider configured (set RESEND_API_KEY or POSTMARK_API_KEY) — skipping email."
    );
    warnedNoProvider = true;
  }
}

/** Fire-and-forget. Schedules the send; never throws into the caller. */
export function dispatch(opts: SendOpts): void {
  void sendNow(opts).catch((e) => {
    console.error(`[email] failed to send "${opts.subject}" to ${opts.to}:`, e?.message ?? e);
  });
}

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
    <h2 style="margin:0 0 12px">${title}</h2>
    ${bodyHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
    <p style="color:#888;font-size:12px">Skimflow — nanopayments for creators on Arc.</p>
  </div>`;
}

// ── Earning notifications (batched) ──────────────────────────────────────────
// Buffer per-creator earning events for a 60s window. On flush: ≤5 events send
// individually; >5 events collapse into one summary email (anti-flood).
export interface EarningEvent {
  creatorId: string;
  to: string;
  creatorName?: string;
  contentTitle: string;
  blockIndex: number;
  gross: string; // decimal USDC
  creatorCut: string; // decimal USDC
  runningTotalToday: string; // decimal USDC
}

interface Buffer {
  events: EarningEvent[];
  timer: ReturnType<typeof setTimeout>;
}

const BATCH_WINDOW_MS = 60_000;
const BATCH_THRESHOLD = 5;
const buffers = new Map<string, Buffer>();

function flushEarnings(creatorId: string): void {
  const buf = buffers.get(creatorId);
  if (!buf) return;
  buffers.delete(creatorId);
  const { events } = buf;
  if (events.length === 0) return;

  if (events.length <= BATCH_THRESHOLD) {
    for (const ev of events) {
      dispatch({
        to: ev.to,
        subject: `You just earned ${ev.creatorCut} USDC on ${ev.contentTitle}`,
        html: layout(
          `💸 You earned ${ev.creatorCut} USDC`,
          `<p>Block ${ev.blockIndex} of <strong>${ev.contentTitle}</strong> was just unlocked.</p>
           <ul>
             <li>Gross payment: <strong>${ev.gross} USDC</strong></li>
             <li>Your cut: <strong>${ev.creatorCut} USDC</strong></li>
             <li>Earned today so far: <strong>${ev.runningTotalToday} USDC</strong></li>
           </ul>`
        ),
      });
    }
    return;
  }

  // >5 in the window → one summary.
  const last = events[events.length - 1];
  let gross = 0;
  let cut = 0;
  for (const ev of events) {
    gross += Number(ev.gross);
    cut += Number(ev.creatorCut);
  }
  const titles = Array.from(new Set(events.map((e) => e.contentTitle)));
  dispatch({
    to: last.to,
    subject: `You earned ${cut.toFixed(6)} USDC across ${events.length} unlocks`,
    html: layout(
      `💸 ${events.length} unlocks in the last minute`,
      `<p>Your content was unlocked <strong>${events.length}</strong> times just now.</p>
       <ul>
         <li>Total gross: <strong>${gross.toFixed(6)} USDC</strong></li>
         <li>Your cut: <strong>${cut.toFixed(6)} USDC</strong></li>
         <li>Earned today so far: <strong>${last.runningTotalToday} USDC</strong></li>
         <li>Content: ${titles.join(", ")}</li>
       </ul>`
    ),
  });
}

export function notifyEarning(ev: EarningEvent): void {
  const existing = buffers.get(ev.creatorId);
  if (existing) {
    existing.events.push(ev);
    return;
  }
  const timer = setTimeout(() => flushEarnings(ev.creatorId), BATCH_WINDOW_MS);
  // Don't keep the process alive solely for a pending email flush.
  if (typeof timer.unref === "function") timer.unref();
  buffers.set(ev.creatorId, { events: [ev], timer });
}

// ── Payout + onboarding emails (sent immediately, still async) ───────────────
export function notifyPayoutInitiated(args: {
  to: string;
  amount: string;
  wallet: string;
  etaText?: string;
}): void {
  const truncated = `${args.wallet.slice(0, 6)}…${args.wallet.slice(-4)}`;
  dispatch({
    to: args.to,
    subject: `Your payout of ${args.amount} USDC is on its way`,
    html: layout(
      `🚀 Payout initiated`,
      `<p>We're sending <strong>${args.amount} USDC</strong> to your linked wallet <code>${truncated}</code>.</p>
       <p>Expected settlement: ${args.etaText ?? "within a few minutes on Arc"}.</p>`
    ),
  });
}

export function notifyPayoutConfirmed(args: {
  to: string;
  amount: string;
  txHash: string;
  explorerUrl?: string;
}): void {
  const link = args.explorerUrl
    ? `<p>View on explorer: <a href="${args.explorerUrl}/tx/${args.txHash}">${args.txHash}</a></p>`
    : `<p>Transaction: <code>${args.txHash}</code></p>`;
  dispatch({
    to: args.to,
    subject: `Payout confirmed — ${args.amount} USDC sent`,
    html: layout(`✅ Payout confirmed`, `<p><strong>${args.amount} USDC</strong> has settled to your wallet.</p>${link}`),
  });
}

export function notifyFirstPublish(args: {
  to: string;
  name?: string;
  title: string;
  readerUrl: string;
  agentUrl?: string;
}): void {
  const agentLine = args.agentUrl
    ? `<p>Agents can pay-per-block via your machine-readable endpoint:<br/><a href="${args.agentUrl}">${args.agentUrl}</a></p>`
    : "";
  dispatch({
    to: args.to,
    subject: `🎉 Your first piece is live: ${args.title}`,
    html: layout(
      `Welcome to Skimflow${args.name ? `, ${args.name}` : ""}!`,
      `<p>Your content <strong>${args.title}</strong> is published.</p>
       <p>Share your reader link with humans:<br/><a href="${args.readerUrl}">${args.readerUrl}</a></p>
       ${agentLine}
       <p>You'll get an email each time someone unlocks a block.</p>`
    ),
  });
}
