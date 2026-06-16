"use client";

import { createContext, useCallback, useContext, useState } from "react";

export type ToastKind = "info" | "success" | "error" | "warning";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  title?: string;
}

type ToastFn = (kind: ToastKind, text: string, title?: string) => void;

const ToastContext = createContext<ToastFn | null>(null);

/** App-wide toast notifications. Wrap the tree once; call `useToast()` anywhere. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback<ToastFn>((kind, text, title) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((t) => [...t, { id, kind, text, title }]);
    // Errors linger; info/success auto-dismiss faster.
    const ttl = kind === "error" ? 8000 : 4500;
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  // Fail soft: if the provider is missing, fall back to console so callers
  // never crash.
  if (!ctx) return (kind, text) => console[kind === "error" ? "error" : "log"](`[toast:${kind}] ${text}`);
  return ctx;
}

const STYLES: Record<ToastKind, { bar: string; icon: string; symbol: string }> = {
  success: { bar: "bg-secondary", icon: "text-secondary", symbol: "check_circle" },
  error: { bar: "bg-primary", icon: "text-primary", symbol: "error" },
  warning: { bar: "bg-[#b8860b]", icon: "text-[#b8860b]", symbol: "warning" },
  info: { bar: "bg-on-surface/40", icon: "text-on-surface-variant", symbol: "info" },
};

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const s = STYLES[toast.kind];
  return (
    <div className="pointer-events-auto flex overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-lg animate-[fadeIn_0.15s_ease-out]">
      <div className={`w-1 shrink-0 ${s.bar}`} />
      <div className="flex flex-1 items-start gap-3 p-3">
        <span className={`material-symbols-outlined text-[20px] ${s.icon}`} style={{ fontVariationSettings: "'FILL' 1" }}>
          {s.symbol}
        </span>
        <div className="flex-1">
          {toast.title && <p className="font-headline-sm text-[13px] font-semibold text-on-surface">{toast.title}</p>}
          <p className="font-body-sm text-[13px] leading-snug text-on-surface-variant">{toast.text}</p>
        </div>
        <button onClick={onClose} className="text-outline hover:text-on-surface" aria-label="Dismiss">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
    </div>
  );
}
