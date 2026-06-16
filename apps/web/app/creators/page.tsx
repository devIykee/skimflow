"use client";

import { useEffect, useState } from "react";

interface Creator { id: string; handle: string; display_name: string; wallet: string; verified: number }

export default function CreatorsPage() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [earnings, setEarnings] = useState<any>(null);
  const [msg, setMsg] = useState("");

  // register form
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [wallet, setWallet] = useState("0x");
  const [verified, setVerified] = useState(false);

  // upload form
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("article");
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [price, setPrice] = useState("0.00005");
  const [body, setBody] = useState("");

  const loadCreators = () => fetch("/api/creators").then((r) => r.json()).then((d) => setCreators(d.creators ?? []));
  useEffect(() => { loadCreators(); }, []);

  useEffect(() => {
    const c = creators.find((x) => x.id === selected);
    if (!c) { setEarnings(null); return; }
    fetch(`/api/creators/${c.handle}/earnings`).then((r) => r.json()).then(setEarnings);
  }, [selected, creators]);

  async function register() {
    const res = await fetch("/api/creators", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle, display_name: name || handle, wallet, verified }),
    });
    const d = await res.json();
    if (d.creator) { setMsg(`Registered @${d.creator.handle}`); await loadCreators(); setSelected(d.creator.id); }
    else setMsg(d.error ?? "error");
  }

  async function upload() {
    const c = creators.find((x) => x.id === selected);
    if (!c) { setMsg("select a creator first"); return; }
    const res = await fetch("/api/content", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ creatorHandle: c.handle, title, kind, summary, tags, pricePerLine: Number(price), body }),
    });
    const d = await res.json();
    if (d.content) {
      setMsg(`Published "${d.content.title}" (${d.content.line_count} lines)`);
      setTitle(""); setBody(""); setSummary(""); setTags("");
      fetch(`/api/creators/${c.handle}/earnings`).then((r) => r.json()).then(setEarnings);
    } else setMsg(d.error ?? "error");
  }

  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

  return (
    <div className="mx-auto max-w-max-width px-margin-mobile py-stack-lg md:px-margin-desktop">
      <header className="mb-12">
        <h1 className="mb-2 font-display-lg text-display-lg-mobile md:text-display-lg">Creator Portal</h1>
        <p className="max-w-2xl font-body-lg text-body-lg text-on-surface-variant">
          Manage your identity and publish protected work with per-line micro-payment enforcement.
        </p>
      </header>

      {msg && <p className="mb-stack-lg pill">{msg}</p>}

      <div className="mb-16 grid grid-cols-1 gap-gutter lg:grid-cols-12">
        {/* Registration */}
        <section className="card rounded-lg lg:col-span-4">
          <h2 className="mb-6 border-b border-outline-variant pb-2 font-headline-sm text-headline-sm">Registration</h2>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col">
              <label className="label-caps mb-1">Select creator</label>
              <select className="input-editorial cursor-pointer" value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="">— pick a creator —</option>
                {creators.map((c) => (
                  <option key={c.id} value={c.id}>@{c.handle} {c.verified ? "✓" : ""}</option>
                ))}
              </select>
            </div>
            <div className="border-t border-outline-variant pt-4 flex flex-col gap-5">
              <div className="flex flex-col">
                <label className="label-caps mb-1">Handle</label>
                <input className="input-editorial font-data-mono text-data-mono" placeholder="@username" value={handle} onChange={(e) => setHandle(e.target.value)} />
              </div>
              <div className="flex flex-col">
                <label className="label-caps mb-1">Display name</label>
                <input className="input-editorial" placeholder="Your Name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="flex flex-col">
                <label className="label-caps mb-1">Wallet address</label>
                <input className="input-editorial font-data-mono text-body-sm" placeholder="0x… (Arc)" value={wallet} onChange={(e) => setWallet(e.target.value)} />
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" className="peer sr-only" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
                <span className="flex h-5 w-5 items-center justify-center rounded border-2 border-outline transition-colors peer-checked:border-primary peer-checked:bg-primary/5">
                  <span className="material-symbols-outlined scale-0 text-[18px] text-primary transition-transform peer-checked:scale-100">check</span>
                </span>
                <span className="font-body-sm text-body-sm text-on-surface">Verified creator</span>
              </label>
              <button className="btn-outline" onClick={register}>Register</button>
            </div>
          </div>
        </section>

        {/* Upload */}
        <section className="card rounded-lg lg:col-span-8">
          <div className="mb-6 flex items-center justify-between border-b border-outline-variant pb-2">
            <h2 className="font-headline-sm text-headline-sm">Publish Content</h2>
            <span className="flex items-center gap-1 font-label-caps text-label-caps text-secondary">
              <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>security</span>
              x402 Protected
            </span>
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
            <div className="flex flex-col md:col-span-2">
              <label className="label-caps mb-1">Title</label>
              <input className="input-editorial font-headline-sm italic" placeholder="The Ethics of Infinite Computation" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col">
              <label className="label-caps mb-1">Type</label>
              <select className="input-editorial cursor-pointer" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="article">Article</option>
                <option value="novel_chapter">Novel chapter</option>
                <option value="agent-skill">Agent skill</option>
                <option value="prompt-template">Prompt template</option>
                <option value="knowledge-base">Knowledge base</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="label-caps mb-1">Price per line (USD)</label>
              <div className="flex items-center">
                <span className="mr-2 font-data-mono text-on-surface-variant">$</span>
                <input className="input-editorial font-data-mono" type="number" step="0.00001" placeholder="0.00005" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col md:col-span-2">
              <label className="label-caps mb-1">Summary</label>
              <input className="input-editorial" placeholder="A brief overview of the content…" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div className="flex flex-col md:col-span-2">
              <label className="label-caps mb-1">Tags (comma separated)</label>
              <input className="input-editorial" placeholder="philosophy, fintech" value={tags} onChange={(e) => setTags(e.target.value)} />
              {tagList.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {tagList.map((t) => <span key={t} className="pill">{t}</span>)}
                </div>
              )}
            </div>
            <div className="flex flex-col md:col-span-2">
              <label className="label-caps mb-1">Content body (Markdown — priced per line)</label>
              <textarea className="input-editorial font-data-mono text-body-sm" rows={8} placeholder="# Introduction…" value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="flex justify-end md:col-span-2">
              <button className="btn-primary px-8 py-3" onClick={upload}>Publish (x402-protected)</button>
            </div>
          </div>
        </section>
      </div>

      {/* Earnings dashboard */}
      {earnings && (
        <section className="mt-16">
          <h2 className="mb-8 font-headline-md text-headline-md">
            Earnings Dashboard <span className="text-on-surface-variant">— @{earnings.creator?.handle}</span>
          </h2>
          <div className="mb-12 grid grid-cols-1 gap-gutter md:grid-cols-3">
            <StatTile label="Earned" value={earnings.earnedDisplay} sub="creator share" tone="primary" />
            <StatTile label="Total payments" value={earnings.payments} sub="settled on Arc" />
            <StatTile label="Lines sold" value={earnings.linesSold} sub="per-line nanopayments" />
          </div>

          <div className="overflow-x-auto rounded-lg border border-on-surface/10 bg-surface-container-lowest editorial-shadow">
            <table className="w-full border-collapse text-left">
              <thead className="bg-surface-container-high">
                <tr>
                  {["Time", "Content Title", "Line Range", "Amount Earned", "Tx Hash"].map((h, i) => (
                    <th key={h} className={`px-6 py-4 label-caps ${i === 3 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(earnings.history ?? []).map((h: any) => (
                  <tr key={h.id} className="transition-colors hover:bg-surface-container-low">
                    <td className="whitespace-nowrap px-6 py-4 font-body-sm">{new Date(h.created_at).toLocaleTimeString()}</td>
                    <td className="px-6 py-4 font-body-md font-bold">{h.title}</td>
                    <td className="px-6 py-4 font-data-mono text-body-sm">L{h.line_start} – L{h.line_end}</td>
                    <td className="px-6 py-4 text-right font-data-mono text-body-sm text-primary">{h.amountDisplay}</td>
                    <td className="px-6 py-4">
                      <span className="code-chip max-w-[140px]"><span className="truncate">{h.tx_hash.slice(0, 10)}…</span></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!earnings.history || earnings.history.length === 0) && (
              <div className="px-6 py-6 text-center font-body-sm text-on-surface-variant">No sales yet — run the agent on the demo page.</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: any; sub: string; tone?: "primary" }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-on-surface/10 bg-surface-container-low p-8 text-center">
      <span className="label-caps mb-2">{label}</span>
      <div className={`font-display-lg text-display-lg-mobile ${tone === "primary" ? "text-primary" : "text-on-surface"}`}>{value}</div>
      <div className="mt-2 font-body-sm text-body-sm text-on-surface-variant">{sub}</div>
    </div>
  );
}
