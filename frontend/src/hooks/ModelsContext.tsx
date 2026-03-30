import React, { createContext, useContext, useState, useEffect } from "react";
import { apiFetch } from "./useApi";

export interface ModelInfo {
  id: string;
  label: string;
  resolution: string;
  time_estimate: string;
  multimodal: boolean;
}

interface ModelsCtx {
  models: ModelInfo[];
  defaultModelId: string;
}

const Ctx = createContext<ModelsCtx>({ models: [], defaultModelId: "" });

export function ModelsProvider({ children }: { children: React.ReactNode }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModelId, setDefaultModelId] = useState("");

  useEffect(() => {
    apiFetch<{ models: ModelInfo[]; current: string }>("/system/models")
      .then((r) => {
        setModels(r.models.filter((m) => m.multimodal));
        setDefaultModelId(r.current);
      })
      .catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ models, defaultModelId }}>
      {children}
    </Ctx.Provider>
  );
}

export function useModels() {
  return useContext(Ctx);
}
