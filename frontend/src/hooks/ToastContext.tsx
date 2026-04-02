import React, { createContext, useContext } from "react";
import { useToast, type Toast } from "./useToast";
import { ToastContainer } from "@/components/shared/ToastContainer";

interface ToastCtx {
  addToast: (message: string, level?: Toast["level"]) => number;
  updateToast: (id: number, updates: Partial<Pick<Toast, "message" | "level" | "progress">>) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<ToastCtx>({ addToast: () => 0, updateToast: () => {}, dismissToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, addToast, updateToast, dismissToast } = useToast();
  return (
    <Ctx.Provider value={{ addToast, updateToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </Ctx.Provider>
  );
}

export function useToastContext() {
  return useContext(Ctx);
}
