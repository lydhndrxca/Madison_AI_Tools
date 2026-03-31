import { useCallback, useState } from "react";
import { Layers, Download, Loader2, Eye, X } from "lucide-react";
import { extractPbrMaps, type PbrMaps } from "@/lib/workshopApi";

const CHANNEL_LABELS: Record<string, string> = {
  albedo: "Albedo",
  normal: "Normal",
  roughness: "Roughness",
  metallic: "Metallic",
  ao: "AO",
};

const CHANNEL_ORDER = ["albedo", "normal", "roughness", "metallic", "ao"];

export interface PbrMapsPanelProps {
  projectId: string | null;
  versionId?: string;
}

export function PbrMapsPanel({ projectId, versionId }: PbrMapsPanelProps) {
  const [maps, setMaps] = useState<PbrMaps | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewImage, setViewImage] = useState<{ channel: string; material: string; src: string } | null>(null);

  const handleExtract = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await extractPbrMaps(projectId, versionId);
      setMaps(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  }, [projectId, versionId]);

  const downloadChannel = useCallback((b64: string, matName: string, channel: string) => {
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${b64}`;
    a.download = `${matName}_${channel}.png`;
    a.click();
  }, []);

  const downloadAll = useCallback(() => {
    if (!maps) return;
    for (const [matName, channels] of Object.entries(maps)) {
      for (const [ch, val] of Object.entries(channels)) {
        if (typeof val === "string") {
          downloadChannel(val, matName, ch);
        }
      }
    }
  }, [maps, downloadChannel]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Layers className="h-3 w-3" style={{ color: "var(--color-text-muted)" }} />
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
          PBR Maps
        </span>
      </div>

      <button
        type="button"
        onClick={handleExtract}
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
          <><Loader2 className="h-3 w-3 inline-block animate-spin mr-1" style={{ verticalAlign: "text-bottom" }} />Extracting...</>
        ) : (
          "Extract PBR Maps"
        )}
      </button>

      {error && (
        <div className="text-[9px] px-2 py-1 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
          {error}
        </div>
      )}

      {maps && Object.keys(maps).length > 0 && (
        <div className="space-y-2">
          {Object.entries(maps).map(([matName, channels]) => (
            <div key={matName}>
              <div className="text-[9px] font-semibold mb-1 truncate" style={{ color: "var(--color-text-secondary)" }}>
                {matName}
              </div>
              <div className="grid grid-cols-3 gap-1">
                {CHANNEL_ORDER.map((ch) => {
                  const val = channels[ch];
                  if (!val) return null;
                  const isImage = typeof val === "string";
                  return (
                    <div
                      key={ch}
                      className="relative group rounded overflow-hidden cursor-pointer"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      onClick={() => isImage && setViewImage({ channel: ch, material: matName, src: val })}
                    >
                      {isImage ? (
                        <img
                          src={`data:image/png;base64,${val}`}
                          alt={`${matName} ${ch}`}
                          className="w-full aspect-square object-cover"
                        />
                      ) : (
                        <div className="w-full aspect-square flex items-center justify-center text-[8px]" style={{ color: "var(--color-text-muted)" }}>
                          Solid
                        </div>
                      )}
                      <div
                        className="absolute bottom-0 left-0 right-0 text-center text-[8px] py-0.5"
                        style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-primary)" }}
                      >
                        {CHANNEL_LABELS[ch] ?? ch}
                      </div>
                      {isImage && (
                        <div className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); downloadChannel(val, matName, ch); }}
                            className="h-4 w-4 rounded flex items-center justify-center"
                            style={{ background: "rgba(0,0,0,0.6)" }}
                            title="Download"
                          >
                            <Download className="h-2.5 w-2.5 text-white" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={downloadAll}
            className="w-full py-1 rounded text-[9px] flex items-center justify-center gap-1"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--color-text-secondary)",
              cursor: "pointer",
            }}
          >
            <Download className="h-3 w-3" /> Download All
          </button>
        </div>
      )}

      {/* Full-size viewer modal */}
      {viewImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setViewImage(null)}
        >
          <div className="relative max-w-[80vw] max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:image/png;base64,${viewImage.src}`}
              alt={`${viewImage.material} ${viewImage.channel}`}
              className="max-w-full max-h-[80vh] object-contain rounded"
            />
            <div
              className="absolute top-2 left-2 px-2 py-1 rounded text-[11px] font-semibold"
              style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
            >
              {viewImage.material} — {CHANNEL_LABELS[viewImage.channel] ?? viewImage.channel}
            </div>
            <button
              type="button"
              onClick={() => setViewImage(null)}
              className="absolute top-2 right-2 h-6 w-6 rounded-full flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.7)", color: "white" }}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="absolute bottom-2 right-2 flex gap-1">
              <button
                type="button"
                onClick={() => downloadChannel(viewImage.src, viewImage.material, viewImage.channel)}
                className="px-2 py-1 rounded text-[10px] flex items-center gap-1"
                style={{ background: "rgba(255,255,255,0.1)", color: "white" }}
              >
                <Download className="h-3 w-3" /> Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
