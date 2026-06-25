"use client";

import { useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt, switchChain } from "@wagmi/core";
import { erc20Abi, parseUnits } from "viem";
import type { Address } from "viem";
import { formatUsdc, toDecimal } from "@/lib/money";
import { useToast } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";
import { getOrCreateSessionAccount } from "@/lib/session-key-client";
import { paySessionAuthMessage, GATEWAY_WALLET_ADDRESS, ARC_USDC_ADDRESS } from "@/lib/burn-intent";

const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002");
const LIVE = (process.env.NEXT_PUBLIC_PAYMENTS_MODE ?? "simulate").toLowerCase() === "live";

const GATEWAY_WALLET_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addDelegate",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "delegate", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "availableBalance",
    stateMutability: "view",
    inputs: [
      { name: "token", type: "address" },
      { name: "depositor", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface PaySessionInfo {
  sessionId: string;
  sessionAddress: Address;
  mainWallet: Address;
  cap: string;
  spent: string;
  remaining: string;
  recipient: Address;
}

interface Props {
  mainWallet: Address;
  /** "external" = wagmi wallet signs; "embedded" = dev-controlled wallet, signed server-side. */
  kind?: "external" | "embedded";
  /** Suggested cap (e.g. enough for the whole article). */
  suggestedCap?: number;
  /**
   * True when the reader already has an active session and is ADDING funds. A
   * top-up must always deposit the typed amount (never take the "already funded"
   * shortcut), so the new fuel actually lands on-chain on top of what's there.
   */
  isTopUp?: boolean;
  onReady: (session: PaySessionInfo) => void;
  onClose: () => void;
}

/**
 * One-time setup for silent payments. The user chooses how much USDC to deposit
 * (the spend cap) and authorizes a local session key; afterwards chunks unlock
 * with no popup. External wallets do the Gateway approve/deposit/addDelegate via
 * wagmi; embedded (Circle dev-controlled) wallets do the same steps signed server-side.
 */
export default function PaySetupModal({ mainWallet, kind = "external", suggestedCap = 5, isTopUp = false, onReady, onClose }: Props) {
  const [cap, setCap] = useState(String(suggestedCap));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  // When opened as an explicit top-up, default to the "add funds" input.
  const [addMore, setAddMore] = useState(isTopUp);
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const embedded = kind === "embedded";

  // Existing on-chain Gateway balance (USDC base units, null = still checking).
  // When the wallet is already funded — by this app OR any other — the reader can
  // start immediately and we never ask for a deposit.
  const [existingWei, setExistingWei] = useState<bigint | null>(null);
  const checkingBalance = existingWei === null;
  const hasExisting = !!existingWei && existingWei > 0n;
  const existingDecimal = existingWei ? toDecimal(existingWei) : "0";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bal = await gatewayAvailable();
      if (!cancelled) setExistingWei(bal);
    })();
    return () => {
      cancelled = true;
    };
    // gatewayAvailable is stable (closes over mainWallet, which doesn't change here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Current spendable balance already in the user's Gateway account. When this
   * covers the cap we can skip the approve + deposit steps entirely and go
   * straight to addDelegate — one signature/PIN instead of three.
   */
  async function gatewayAvailable(): Promise<bigint> {
    try {
      return (await readContract(wagmiConfig, {
        address: GATEWAY_WALLET_ADDRESS,
        abi: GATEWAY_WALLET_ABI,
        functionName: "availableBalance",
        args: [ARC_USDC_ADDRESS, mainWallet],
      })) as bigint;
    } catch {
      return 0n; // on any read error, fall back to the full deposit flow
    }
  }

  /** External wallet (wagmi) Gateway setup: approve → deposit → addDelegate. */
  async function runExternalSetup(sessionAddress: Address, capWei: bigint, forceDeposit: boolean) {
    setStep("Switching to Arc Testnet…");
    try {
      await switchChain(wagmiConfig, { chainId: ARC_CHAIN_ID });
    } catch {
      /* already on Arc */
    }

    const usdc = ARC_USDC_ADDRESS;
    const gateway = GATEWAY_WALLET_ADDRESS;

    // Skip approve + deposit when the Gateway already holds enough — unless this
    // is an explicit "add funds", which must always deposit the new amount.
    const alreadyFunded = !forceDeposit && (await gatewayAvailable()) >= capWei;

    if (!alreadyFunded) {
      const allowance = (await readContract(wagmiConfig, {
        address: usdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [mainWallet, gateway],
      })) as bigint;

      if (allowance < capWei) {
        setStep("Preparing your reading balance…");
        const hash = await writeContract(wagmiConfig, {
          address: usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [gateway, capWei],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
      }

      setStep("Adding funds to your reading balance…");
      const depositHash = await writeContract(wagmiConfig, {
        address: gateway,
        abi: GATEWAY_WALLET_ABI,
        functionName: "deposit",
        args: [usdc, capWei],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: depositHash });
    }

    setStep("Turning on one-tap reading…");
    const delegateHash = await writeContract(wagmiConfig, {
      address: gateway,
      abi: GATEWAY_WALLET_ABI,
      functionName: "addDelegate",
      args: [usdc, sessionAddress],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: delegateHash });
  }

  /**
   * Embedded (Circle developer-controlled) setup: each step is signed
   * server-side with the entity secret. The route returns a Circle txId; we poll
   * its status to terminal before moving on, since deposit depends on approve and
   * addDelegate on deposit. No PIN — the wallet is custodial.
   */
  async function runEmbeddedStep(
    step: "approve" | "deposit" | "addDelegate",
    sessionAddress: Address,
    capValue: string
  ) {
    const res = await fetch("/api/wallet/embedded/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, cap: capValue, sessionAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? "Setup step failed.");
    await waitForTx(data.txId as string);
  }

  /** Poll a Circle transaction until it confirms (or throw if it fails). */
  async function waitForTx(txId: string) {
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`/api/wallet/tx-status?txId=${encodeURIComponent(txId)}`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      if (d.status === "confirmed") return;
      if (d.status === "failed") throw new Error("A setup transaction failed on-chain.");
      await new Promise((res) => setTimeout(res, 1500));
    }
    throw new Error("Setup is taking longer than expected. Please try again.");
  }

  async function runEmbeddedSetup(sessionAddress: Address, capWei: bigint, capValue: string, forceDeposit: boolean) {
    // Skip straight to addDelegate when already funded — unless adding funds.
    const alreadyFunded = !forceDeposit && (await gatewayAvailable()) >= capWei;
    if (!alreadyFunded) {
      setStep("Preparing your reading balance…");
      await runEmbeddedStep("approve", sessionAddress, capValue);
      setStep("Adding funds to your reading balance…");
      await runEmbeddedStep("deposit", sessionAddress, capValue);
    }
    setStep("Turning on one-tap reading…");
    await runEmbeddedStep("addDelegate", sessionAddress, capValue);
  }

  /**
   * Run setup + open the session. `capValue` is the USDC amount this action
   * involves (a deposit amount, or the existing balance when starting straight
   * away). `forceDeposit` makes the on-chain deposit happen even if the Gateway
   * looks funded (used for explicit "add funds"). The server reconciles the
   * final cap against the real on-chain balance, so the gauge always matches.
   */
  async function authorize(opts?: { capValue?: string; forceDeposit?: boolean }) {
    const capValue = (opts?.capValue ?? cap).trim();
    const forceDeposit = opts?.forceDeposit ?? isTopUp;
    const capNum = Number(capValue);
    if (!Number.isFinite(capNum) || capNum <= 0) {
      toast("warning", "Enter an amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      const account = getOrCreateSessionAccount(mainWallet);

      if (LIVE) {
        toast("info", embedded ? "Setting up your reading balance — no action needed." : "Quick one-time setup. Confirm each step in your wallet.");
        if (embedded) await runEmbeddedSetup(account.address, parseUnits(capValue, 6), capValue, forceDeposit);
        else await runExternalSetup(account.address, parseUnits(capValue, 6), forceDeposit);
      }

      setStep("Finishing setup…");
      let signature: string | undefined;
      if (!embedded) {
        const message = paySessionAuthMessage({ mainWallet, sessionAddress: account.address, cap: capValue });
        toast("info", LIVE ? "Final step: unlock one-tap reading." : "Confirm once to turn on one-tap reading. No funds move.");
        signature = await signMessageAsync({ message });
      }

      const res = await fetch("/api/pay-session/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainWallet,
          sessionAddress: account.address,
          cap: capValue,
          signature,
          source: embedded ? "embedded" : "external",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.friendly ?? data.error ?? "Setup failed.");

      toast("success", `You're set: ${formatUsdc(data.cap)} USDC of reading fuel ready.`);
      onReady(data as PaySessionInfo);
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Setup cancelled.");
      else toast("error", msg, "Couldn't set up reading fuel");
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">bolt</span>
          <h2 className="font-headline-sm text-headline-sm">Read without interruptions</h2>
        </div>
        {checkingBalance ? (
          <p className="flex items-center gap-2 font-body-sm text-[13px] text-on-surface-variant">
            <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
            Checking your reading balance…
          </p>
        ) : hasExisting ? (
          <>
            <p className="mb-4 rounded-lg border border-secondary/30 bg-secondary/5 p-3 font-body-sm text-on-surface-variant">
              You already have <strong className="text-secondary">{formatUsdc(existingDecimal)} USDC</strong> of reading
              fuel available, no deposit needed. Start reading now, or add more.
            </p>

            {addMore && (
              <>
                <label className="mb-1 block font-label-caps text-label-caps text-outline">Add more fuel (USDC)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  disabled={busy}
                  className="mb-3 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono text-on-surface focus:border-primary focus:outline-none"
                />
              </>
            )}

            {busy && step && (
              <p className="mb-4 flex items-center gap-2 font-body-sm text-[13px] text-primary">
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                {step}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 font-body-md text-on-surface hover:bg-surface-container-low">
                Cancel
              </button>
              {addMore ? (
                <button onClick={() => authorize({ capValue: cap, forceDeposit: true })} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
                  {busy ? "Adding…" : "Add funds & read"}
                </button>
              ) : (
                <button onClick={() => authorize({ capValue: existingDecimal, forceDeposit: false })} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
                  {busy ? "Setting up…" : "Start reading"}
                </button>
              )}
            </div>

            {!addMore && (
              <button onClick={() => setAddMore(true)} disabled={busy} className="mt-3 w-full text-center font-body-sm text-[12px] text-primary hover:underline">
                Add more funds
              </button>
            )}
          </>
        ) : (
          <>
            <p className="mb-5 font-body-sm text-on-surface-variant">
              {LIVE
                ? embedded
                  ? "A quick one-time setup adds the amount you choose to your reading balance and turns on one-tap reading automatically — no wallet popup, no PIN. After that, each block unlocks instantly."
                  : "A quick one-time setup adds the amount you choose to your reading balance and turns on one-tap reading. After that, each block unlocks instantly, no wallet popup per block."
                : "Confirm once to turn on one-tap reading. After that, each block unlocks instantly, no wallet popup per block."}{" "}
              You stay in control: it stops at your cap, and you can end it anytime.
            </p>

            <label className="mb-1 block font-label-caps text-label-caps text-outline">
              {LIVE ? "Reading fuel to add (USDC)" : "Reading fuel cap (USDC)"}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              disabled={busy}
              className="mb-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-data-mono text-on-surface focus:border-primary focus:outline-none"
            />
            <p className="mb-5 font-body-sm text-[11px] text-on-surface-variant">
              Type the exact amount you want available for this reading session.
            </p>

            {busy && step && (
              <p className="mb-4 flex items-center gap-2 font-body-sm text-[13px] text-primary">
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                {step}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={busy} className="flex-1 rounded-lg border border-outline-variant px-4 py-2.5 font-body-md text-on-surface hover:bg-surface-container-low">
                Cancel
              </button>
              <button onClick={() => authorize({ forceDeposit: true })} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
                {busy ? "Setting up…" : LIVE ? "Add reading fuel" : "Turn on one-tap reading"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
