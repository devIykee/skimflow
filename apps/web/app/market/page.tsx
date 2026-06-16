"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import {
  useAllContent,
  useUsdcDecimals,
  useUsdcBalance,
  usePublish,
  useBuyFlow,
  useFaucet,
  fmtUsdc,
  marketplaceConfigured,
  MARKETPLACE_ADDRESS,
  type ContentRecord,
  type BuyStage,
} from "@/hooks/useMarketplace";

// ── tiny real toast system (no deps) ─────────────────────────────────────────
type Toast = { id: number; kind: "info" | "success" | "error"; text: string };
let _tid = 0;

export default function MarketPage() {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState<"browse" | "publish">("browse");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = (kind: Toast["kind"], text: string) => {
    const id = ++_tid;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  };

  if (!marketplaceConfigured) return <NotConfigured />;

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg">Agent Skill Marketplace</h1>
          <p className="max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
            Buy and sell AI agent skills, prompts, and knowledge bases on-chain. Pay in USDC on Arc;
            access is recorded on the <span className="font-data-mono text-body-sm">AgentMarketplace</span> contract.
          </p>
        </div>
        <Balance />
      </header>

      <div className="mb-6 flex gap-2">
        <button onClick={() => setTab("browse")} className={tab === "browse" ? "btn-primary" : "btn-outline"}>Browse</button>
        <button onClick={() => setTab("publish")} className={tab === "publish" ? "btn-primary" : "btn-outline"}>Publish</button>
      </div>

      {!isConnected && (
        <div className="mb-6 rounded-lg border border-outline-variant bg-surface-container-low p-4 font-body-md text-on-surface-variant">
          Connect your wallet (top-right) to publish, buy, and read content.
        </div>
      )}

      {tab === "browse" ? <Browse toast={toast} /> : <Publish toast={toast} onDone={() => setTab("browse")} />}

      {/* toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-3 font-body-sm text-white shadow-lg ${
              t.kind === "success" ? "bg-secondary" : t.kind === "error" ? "bg-error" : "bg-inverse-surface"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function Balance() {
  const dec = useUsdcDecimals();
  const { balance } = useUsdcBalance();
  const { mint, isPending } = useFaucet();
  const { isConnected } = useAccount();
  if (!isConnected) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-4 py-2">
      <div>
        <div className="label-caps">USDC balance</div>
        <div className="font-data-mono text-body-md text-primary">{fmtUsdc(balance, dec)}</div>
      </div>
      <button
        className="btn-outline !py-1 !px-3"
        title="Mint test USDC (MockUSDC faucet)"
        onClick={async () => {
          try { await mint("1000", dec); } catch { /* real USDC has no faucet */ }
        }}
        disabled={isPending}
      >
        {isPending ? "…" : "Faucet"}
      </button>
    </div>
  );
}

// ── Browse: real on-chain feed ────────────────────────────────────────────────
function Browse({ toast }: { toast: (k: Toast["kind"], t: string) => void }) {
  const { content, isLoading } = useAllContent();

  if (isLoading) return <p className="font-body-md text-on-surface-variant">Reading the marketplace from chain…</p>;
  if (content.length === 0)
    return <p className="font-body-md text-on-surface-variant">No skills published yet. Switch to <strong>Publish</strong> to mint the first one.</p>;

  return (
    <div className="grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
      {content.map((c) => (
        <SkillCard key={c.id.toString()} item={c} toast={toast} />
      ))}
    </div>
  );
}

function kindBadge(title: string, description: string): string {
  const s = `${title} ${description}`.toLowerCase();
  if (s.includes("prompt")) return "prompt-template";
  if (s.includes("knowledge")) return "knowledge-base";
  if (s.includes("skill") || s.includes("agent")) return "agent-skill";
  return "content";
}

function SkillCard({ item, toast }: { item: ContentRecord; toast: (k: Toast["kind"], t: string) => void }) {
  const dec = useUsdcDecimals();
  const { address } = useAccount();
  const { buy } = useBuyFlow();
  const { signMessageAsync } = useSignMessage();
  const [stage, setStage] = useState<BuyStage>("idle");
  const [text, setText] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const isAuthor = address && address.toLowerCase() === item.author.toLowerCase();
  const badge = kindBadge(item.title, item.description);

  async function unlock() {
    try {
      const hash = await buy(item.id, item.price, (s) => setStage(s));
      setTxHash(hash);
      toast("success", `Purchased "${item.title}" — tx ${hash.slice(0, 10)}…`);
      await reveal();
    } catch (e: any) {
      setStage("error");
      const msg = String(e?.shortMessage ?? e?.message ?? e);
      if (/rejected|denied/i.test(msg)) toast("error", "Transaction rejected.");
      else if (/insufficient/i.test(msg)) toast("error", "Insufficient USDC balance.");
      else toast("error", `Purchase failed: ${msg.slice(0, 80)}`);
    }
  }

  async function reveal() {
    if (!address) return;
    try {
      const message = `Unlock content #${item.id} on LinePay Marketplace · ts=${Date.now()}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: Number(item.id), cid: item.cid, address, message, signature }),
      });
      const d = await res.json();
      if (res.ok) setText(d.text);
      else toast("error", `Reveal failed: ${d.error}`);
    } catch {
      toast("error", "Signature rejected — can't reveal content.");
    }
  }

  return (
    <div className="card flex flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="pill">{badge}</span>
        <span className="font-data-mono text-[11px] text-outline">{Number(item.sales)} sales</span>
      </div>
      <h3 className="mb-1 font-headline-sm text-headline-sm leading-tight">{item.title}</h3>
      <p className="mb-3 flex-grow font-body-sm text-body-sm text-on-surface-variant">{item.description}</p>
      <div className="mb-3 flex items-center justify-between font-data-mono text-[11px] text-outline">
        <span title={item.author}>by {item.author.slice(0, 6)}…{item.author.slice(-4)}</span>
        <span className="text-primary">{fmtUsdc(item.price, dec)}</span>
      </div>

      {text !== null ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-on-surface/10 bg-surface-container-high p-3 font-data-mono text-[12px] text-on-surface">{text}</pre>
      ) : isAuthor ? (
        <button className="btn-outline" onClick={reveal}>Read (you&apos;re the author)</button>
      ) : (
        <button className="btn-primary" onClick={unlock} disabled={stage !== "idle" && stage !== "error" && stage !== "done"}>
          {stage === "checking" && "Checking allowance…"}
          {stage === "approving" && "Approve USDC…"}
          {stage === "buying" && "Buying…"}
          {(stage === "idle" || stage === "error") && `Unlock · ${fmtUsdc(item.price, dec)}`}
          {stage === "done" && "Unlocking…"}
        </button>
      )}
      {txHash && <p className="mt-2 font-data-mono text-[10px] text-outline">receipt {txHash.slice(0, 18)}…</p>}
    </div>
  );
}

// ── Publish: upload to IPFS/local then mint on-chain ─────────────────────────
function Publish({ toast, onDone }: { toast: (k: Toast["kind"], t: string) => void; onDone: () => void }) {
  const { isConnected } = useAccount();
  const dec = useUsdcDecimals();
  const { publish, isPending } = usePublish();
  const [kind, setKind] = useState("agent-skill");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [price, setPrice] = useState("1.00");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!isConnected) return toast("error", "Connect your wallet first.");
    if (!title || !body) return toast("error", "Title and content body are required.");
    setBusy(true);
    try {
      // 1) Encrypt + store off-chain, get a CID.
      const up = await fetch("/api/ipfs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body, kind }),
      });
      const { cid, storage, error } = await up.json();
      if (!cid) throw new Error(error ?? "ipfs_failed");
      toast("info", `Stored content (${storage}). Minting on-chain…`);

      // 2) Publish the pointer on-chain.
      const hash = await publish(cid, `[${kind}] ${title}`, description, price, dec);
      toast("success", `Published! tx ${hash.slice(0, 10)}…`);
      setTitle(""); setDescription(""); setBody("");
      onDone();
    } catch (e: any) {
      const msg = String(e?.shortMessage ?? e?.message ?? e);
      toast("error", /rejected|denied/i.test(msg) ? "Transaction rejected." : `Publish failed: ${msg.slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card max-w-3xl">
      <h2 className="mb-6 border-b border-outline-variant pb-2 font-headline-sm text-headline-sm">Publish a skill</h2>
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        <div className="flex flex-col md:col-span-2">
          <label className="label-caps mb-1">Title</label>
          <input className="input-editorial font-headline-sm italic" placeholder="Web-scraper extraction skill" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col">
          <label className="label-caps mb-1">Type</label>
          <select className="input-editorial cursor-pointer" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="agent-skill">agent-skill</option>
            <option value="prompt-template">prompt-template</option>
            <option value="knowledge-base">knowledge-base</option>
            <option value="article">article</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="label-caps mb-1">Price (USDC)</label>
          <input className="input-editorial font-data-mono" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="flex flex-col md:col-span-2">
          <label className="label-caps mb-1">Description (public)</label>
          <input className="input-editorial" placeholder="What the buyer/agent gets…" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex flex-col md:col-span-2">
          <label className="label-caps mb-1">Content body (gated — encrypted before storage)</label>
          <textarea className="input-editorial font-data-mono text-body-sm" rows={10} placeholder={"# System prompt\nYou are a meticulous research agent…"} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="flex justify-end md:col-span-2">
          <button className="btn-primary px-8 py-3" onClick={submit} disabled={busy || isPending}>
            {busy || isPending ? "Publishing…" : "Encrypt → store → mint on-chain"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="mx-auto max-w-2xl px-margin-mobile py-32 md:px-margin-desktop">
      <h1 className="mb-4 font-display-lg text-display-lg-mobile">Marketplace not configured</h1>
      <p className="mb-4 font-body-md text-on-surface-variant">
        Deploy the contracts and set the addresses to enable the on-chain marketplace:
      </p>
      <pre className="overflow-auto rounded-lg border border-on-surface/10 bg-surface-container-high p-4 font-data-mono text-[12px]">{`# 1. deploy a test USDC (skip if your network has one)
cd contracts && npm run deploy:mock-usdc:local

# 2. deploy the marketplace
USDC_ADDRESS=<usdc> npm run deploy:marketplace:local

# 3. set in apps/web/.env.local
NEXT_PUBLIC_USDC_ADDRESS=<usdc>
NEXT_PUBLIC_MARKETPLACE_ADDRESS=<deployed>
NEXT_PUBLIC_ARC_RPC_URL=...
NEXT_PUBLIC_ARC_CHAIN_ID=...
NEXT_PUBLIC_WC_PROJECT_ID=...   # walletconnect`}</pre>
      <p className="mt-4 font-body-sm text-on-surface-variant">
        The per-line x402 reading experience (<a className="text-primary" href="/read">/read</a>) works without any of this — it&apos;s the simulate-mode nanopayment flow.
      </p>
    </div>
  );
}
