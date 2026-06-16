"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

/** Real RainbowKit connect button — used in the global header. */
export default function WalletButton() {
  return (
    <ConnectButton
      accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
      chainStatus="icon"
      showBalance={false}
    />
  );
}
