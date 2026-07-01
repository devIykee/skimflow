"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useEffect, useState } from "react";
import { SessionProvider } from "next-auth/react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, lightTheme, darkTheme } from "@rainbow-me/rainbowkit";
import { MotionConfig } from "framer-motion";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/Toaster";
import DepositWatcher from "@/components/DepositWatcher";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

/**
 * Client provider tree for the on-chain marketplace. Wraps the whole app so the
 * wallet connection is global. Editorial terracotta accent to match the brand.
 *
 * The RainbowKit modal theme follows the app's light/dark mode (tracked via the
 * `dark` class on <html>) so the "Connect a Wallet" dialog never gets stranded
 * in light mode while the rest of the app is dark.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const rkTheme = (isDark ? darkTheme : lightTheme)({
    accentColor: "#99411e",
    accentColorForeground: "#ffffff",
    borderRadius: "medium",
    fontStack: "system",
  });

  return (
    <SessionProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rkTheme}>
            <ToastProvider>
              {/* All motion respects the OS "reduce motion" setting. */}
              <MotionConfig reducedMotion="user">
                <DepositWatcher />
                <ServiceWorkerRegister />
                {children}
              </MotionConfig>
            </ToastProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </SessionProvider>
  );
}
