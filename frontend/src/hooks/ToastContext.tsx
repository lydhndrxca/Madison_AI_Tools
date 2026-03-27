import React, { createContext, useContext } from "react";
import { useToast, type Toast } from "./useToast";
import { ToastContainer } from "@/components/shared/ToastContainer";

interface ToastCtx {
  addToast: (message: string, level?: Toast["level"]) => void;
}

const Ctx = createContext<ToastCtx>({ addToast: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { toasts, addToast, dismissToast } = useToast();
  return (
    <Ctx.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </Ctx.Provider>
  );
}

export function useToastContext() {
  return useContext(Ctx);
}
