import { useCallback, useState } from "react";
import { Brain, Loader2, Wand2, Eye, X, ChevronDown, ChevronRight } from "lucide-react";
import { analyzeMaterials, type MaterialRegion } from "@/lib/workshopApi";

export interface AiAnalyzePanelProps {
  projectId: string | null;
  versionId?: string;
  onApplyPrompt?: (prompt: string) => void;
}

export function AiAnalyzePanel({ projectId, versionId, onApplyPrompt }: AiAnalyzePanelProps) {
  const [regions, setRegions] = useState<MaterialRegion[]>([]);
  const [views, setViews] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showViews, setShowViews] = useState(false);
  const [viewImage, setViewImage] = useState<{ name: string; src: string } | null>(null);

  const handleAnalyze = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setRegions([]);
    setViews({});
    try {
      const result = await analyzeMaterials(projectId, versionId);
      setRegions(result.regions);
      setViews(result.views);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [projectId, versionId]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Brain className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          AI Material Analysis
        </span>
      </div>

      <button
        type="button"
        onClick={handleAnalyze}
        disabled={!projectId || loading}
        className="w-full py-1.5 rounded text-[10px] font-semibold transition-colors"
        style={{
          background: projectId && !loading ? "rgba(139,92,246,0.15)" : "rgba(255,255,255,0.04)",
          color: projectId && !loading ? "#a78bfa" : "var(--color-text-muted)",
          border: "1px solid rgba(139,92,246,0.2)",
          cursor: projectId && !loading ? "pointer" : "default",
        }}
      >
        {loading ? (
          <>
            <Loader2 className="h-3 w-3 inline-block animate-spin mr-1" style={{ verticalAlign: "text-bottom" }} />
            Analyzing (renders 6 views + Gemini)...
          </>
        ) : (
          <>
            <Brain className="h-3 w-3 inline-block mr-1" style={{ verticalAlign: "text-bottom" }} />
            AI Analyze
          </>
        )}
      </button>

      {error && (
        <div className="text-[9px] px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {/* Ortho views gallery */}
      {Object.keys(views).length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowViews(!showViews)}
            className="flex items-center gap-1 text-[9px] font-semibold w-full text-left"
            style={{ color: "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer" }}
          >
            {showViews ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Orthographic Views ({Object.keys(views).length})
          </button>
          {showViews && (
            <div className="grid grid-cols-3 gap-1 mt-1">
              {Object.entries(views).map(([name, b64]) => (
                <div
                  key={name}
                  className="relative cursor-pointer group rounded overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                  onClick={() => setViewImage({ name, src: b64 })}
                >
                  <img
                    src={`data:image/png;base64,${b64}`}
                    alt={name}
                    className="w-full aspect-square object-cover"
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 text-center text-[7px] py-0.5"
                    style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-primary)" }}
                  >
                    {name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detected regions */}
      {regions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] font-semibold" style={{ color: "var(--color-text-secondary)" }}>
            Detected Regions ({regions.length})
          </div>
          {regions.map((region, i) => (
            <div
              key={i}
              className="rounded px-2 py-1.5"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {region.name}
                </span>
                <span
                  className="text-[8px] px-1 py-0.5 rounded"
                  style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}
                >
                  {region.material_type}
                </span>
              </div>
              <div className="text-[9px] mb-1" style={{ color: "var(--color-text-muted)" }}>
                {region.approximate_location}
              </div>
              <div className="text-[9px] italic mb-1" style={{ color: "var(--color-text-secondary)" }}>
                "{region.suggested_prompt}"
              </div>
              {onApplyPrompt && (
                <button
                  type="button"
                  onClick={() => onApplyPrompt(region.suggested_prompt)}
                  className="flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(139,92,246,0.1)",
                    color: "#a78bfa",
                    border: "1px solid rgba(139,92,246,0.2)",
                    cursor: "pointer",
                  }}
                >
                  <Wand2 className="h-2.5 w-2.5" /> Apply as Retexture Prompt
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* View image modal */}
      {viewImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setViewImage(null)}
        >
          <div className="relative max-w-[70vw] max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:image/png;base64,${viewImage.src}`}
              alt={viewImage.name}
              className="max-w-full max-h-[70vh] object-contain rounded"
            />
            <div
              className="absolute top-2 left-2 px-2 py-1 rounded text-[11px] font-semibold"
              style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
            >
              {viewImage.name}
            </div>
            <button
              type="button"
              onClick={() => setViewImage(null)}
              className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
