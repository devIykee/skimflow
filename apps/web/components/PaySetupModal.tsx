"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";
import { readContract, writeContract, waitForTransactionReceipt, switchChain } from "@wagmi/core";
import { erc20Abi, parseUnits } from "viem";
import type { Address } from "viem";
import { useToast } from "@/components/Toaster";
import { wagmiConfig } from "@/lib/wagmi";
import { getOrCreateSessionAccount } from "@/lib/session-key-client";
import { executeChallenge } from "@/lib/useEmbeddedWallet";
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
  /** "external" = wagmi wallet signs; "embedded" = Circle PIN challenges. */
  kind?: "external" | "embedded";
  /** Suggested cap (e.g. enough for the whole article). */
  suggestedCap?: number;
  onReady: (session: PaySessionInfo) => void;
  onClose: () => void;
}

/**
 * One-time setup for silent payments. The user chooses how much USDC to deposit
 * (the spend cap) and authorizes a local session key; afterwards chunks unlock
 * with no popup. External wallets do the Gateway approve/deposit/addDelegate via
 * wagmi; embedded (Circle) wallets do the same steps via PIN-approved challenges.
 */
export default function PaySetupModal({ mainWallet, kind = "external", suggestedCap = 5, onReady, onClose }: Props) {
  const [cap, setCap] = useState(String(suggestedCap));
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const embedded = kind === "embedded";

  /** External wallet (wagmi) Gateway setup: approve → deposit → addDelegate. */
  async function runExternalSetup(sessionAddress: Address, capWei: bigint) {
    setStep("Switching to Arc Testnet…");
    try {
      await switchChain(wagmiConfig, { chainId: ARC_CHAIN_ID });
    } catch {
      /* already on Arc */
    }

    const usdc = ARC_USDC_ADDRESS;
    const gateway = GATEWAY_WALLET_ADDRESS;

    const allowance = (await readContract(wagmiConfig, {
      address: usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [mainWallet, gateway],
    })) as bigint;

    if (allowance < capWei) {
      setStep("Approve USDC for the Gateway…");
      const hash = await writeContract(wagmiConfig, {
        address: usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [gateway, capWei],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
    }

    setStep("Depositing USDC into your Gateway balance…");
    const depositHash = await writeContract(wagmiConfig, {
      address: gateway,
      abi: GATEWAY_WALLET_ABI,
      functionName: "deposit",
      args: [usdc, capWei],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: depositHash });

    setStep("Authorizing the session key (addDelegate)…");
    const delegateHash = await writeContract(wagmiConfig, {
      address: gateway,
      abi: GATEWAY_WALLET_ABI,
      functionName: "addDelegate",
      args: [usdc, sessionAddress],
    });
    await waitForTransactionReceipt(wagmiConfig, { hash: delegateHash });
  }

  /** Embedded (Circle) setup: each step is a backend challenge executed via PIN. */
  async function runEmbeddedChallenge(
    step: "approve" | "deposit" | "addDelegate",
    sessionAddress: Address
  ) {
    const res = await fetch("/api/wallet/embedded/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, cap, sessionAddress }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? data.error ?? "Setup step failed.");
    await executeChallenge(data.challengeId, {
      userToken: data.userToken,
      encryptionKey: data.encryptionKey,
    });
  }

  async function runEmbeddedSetup(sessionAddress: Address) {
    setStep("Approve USDC for the Gateway (enter your PIN)…");
    await runEmbeddedChallenge("approve", sessionAddress);
    setStep("Depositing USDC into your Gateway balance…");
    await runEmbeddedChallenge("deposit", sessionAddress);
    setStep("Authorizing this device (addDelegate)…");
    await runEmbeddedChallenge("addDelegate", sessionAddress);
  }

  async function authorize() {
    const capNum = Number(cap);
    if (!Number.isFinite(capNum) || capNum <= 0) {
      toast("warning", "Enter a deposit amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      const account = getOrCreateSessionAccount(mainWallet);

      if (LIVE) {
        toast("info", embedded ? "One-time setup — approve each step with your PIN." : "One-time on-chain setup — approve each step in your wallet.");
        if (embedded) await runEmbeddedSetup(account.address);
        else await runExternalSetup(account.address, parseUnits(cap, 6));
      }

      setStep("Confirm authorization…");
      let signature: string | undefined;
      if (!embedded) {
        const message = paySessionAuthMessage({ mainWallet, sessionAddress: account.address, cap });
        toast("info", LIVE ? "Final step: sign to link this device." : "Sign once to authorize silent payments — no funds move.");
        signature = await signMessageAsync({ message });
      }

      const res = await fetch("/api/pay-session/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainWallet,
          sessionAddress: account.address,
          cap,
          signature,
          source: embedded ? "embedded" : "external",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.friendly ?? data.error ?? "Setup failed.");

      toast("success", `Silent payments on — up to ${data.cap} USDC, no more popups.`);
      onReady(data as PaySessionInfo);
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/rejected|denied|cancell?ed/i.test(msg)) toast("info", "Setup cancelled.");
      else toast("error", msg, "Couldn't enable silent payments");
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
        <p className="mb-5 font-body-sm text-on-surface-variant">
          {LIVE
            ? embedded
              ? "A quick one-time setup deposits the amount you choose into your Circle Gateway balance and authorizes this device with your PIN. After that, each block unlocks instantly — no PIN per block."
              : "A quick one-time setup deposits the amount you choose into your Circle Gateway balance and authorizes this device. After that, each block unlocks instantly — no wallet popup per block."
            : "Sign once to authorize this device. After that, each block unlocks instantly — no wallet popup per block."}{" "}
          You stay in control: payments stop at your cap, and you can revoke anytime.
        </p>

        <label className="mb-1 block font-label-caps text-label-caps text-outline">
          {LIVE ? "Amount to deposit / spend cap (USDC)" : "Spend cap (USDC)"}
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
          <button onClick={authorize} disabled={busy} className="btn-primary flex-[2] px-4 py-2.5">
            {busy ? "Setting up…" : LIVE ? "Set up silent payments" : "Authorize silent payments"}
          </button>
        </div>
      </div>
    </div>
  );
}
