"use client";

/**
 * Client hook for the Circle User-Controlled (embedded) wallet. Wraps the W3S
 * Web SDK challenge flow: the backend creates challenges, the SDK executes them
 * with the user's PIN. The SDK is browser-only, so it's dynamically imported.
 *
 * Exposes:
 *   provision()        — create the wallet (PIN setup), then persist its address
 *   executeChallenge() — run a backend-created challenge (used by silent-pay setup)
 *   status            — { hasWallet, address, walletSource, isAdmin, enabled }
 */
import { useCallback, useEffect, useState } from "react";

export interface EmbeddedStatus {
  enabled: boolean;
  isAdmin: boolean;
  hasWallet: boolean;
  address: string | null;
  walletId: string | null;
  walletSource: string | null;
  payoutAddress: string | null;
}

// Minimal shape of the lazily-loaded W3S SDK (avoids importing browser-only code at module scope).
type W3SSdkLike = {
  setAuthentication: (a: { userToken: string; encryptionKey: string }) => void;
  getDeviceId: () => Promise<string>;
  execute: (challengeId: string, cb: (err: unknown, result: unknown) => void) => void;
};

let sdkSingleton: W3SSdkLike | null = null;

async function getSdk(): Promise<W3SSdkLike> {
  if (sdkSingleton) return sdkSingleton;
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_CIRCLE_APP_ID is not set.");
  const mod = await import("@circle-fin/w3s-pw-web-sdk");
  const W3SSdk = mod.W3SSdk;
  const sdk = new W3SSdk({ appSettings: { appId } }) as unknown as W3SSdkLike;
  // Required before execute() or the challenge silently fails.
  await sdk.getDeviceId();
  sdkSingleton = sdk;
  return sdk;
}

/** Run a backend-issued challenge with the user's PIN. Resolves on success. */
export async function executeChallenge(
  challengeId: string,
  auth: { userToken: string; encryptionKey: string }
): Promise<void> {
  const sdk = await getSdk();
  sdk.setAuthentication(auth);
  await new Promise<void>((resolve, reject) => {
    sdk.execute(challengeId, (err) => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve();
    });
  });
}

export function useEmbeddedWallet() {
  const [status, setStatus] = useState<EmbeddedStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/embedded", { credentials: "include" });
      if (res.ok) setStatus((await res.json()) as EmbeddedStatus);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Create the embedded wallet (PIN setup), then persist + refresh status. */
  const provision = useCallback(async (): Promise<EmbeddedStatus | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/wallet/embedded", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Provisioning failed.");
      if (data.alreadyProvisioned) {
        await refresh();
        return null;
      }
      await executeChallenge(data.challengeId, {
        userToken: data.userToken,
        encryptionKey: data.encryptionKey,
      });
      // Persist the freshly-created wallet address server-side.
      const confirm = await fetch("/api/wallet/embedded/confirm", {
        method: "POST",
        credentials: "include",
      });
      if (!confirm.ok) {
        const c = await confirm.json().catch(() => ({}));
        throw new Error(c.message ?? "Couldn't save your new wallet.");
      }
      await refresh();
      return (await confirm.json()) as EmbeddedStatus;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { status, busy, provision, refresh };
}
