import { useCallback } from "react";
import { X, Rocket, ImagePlus } from "lucide-react";
import { useArtboard, type BucketImage } from "@/hooks/ArtboardContext";
import type { PageId } from "@/app";

const toolPageMap: Record<string, PageId> = {
  "character generator": "character",
  "character": "character",
  "ai proplab": "prop",
  "prop": "prop",
  "ai environment lab": "environment",
  "environment": "environment",
  "weapon generator": "weapon",
  "weapon": "weapon",
  "ai uilab": "uilab",
  "uilab": "uilab",
  "gemini": "gemini",
  "multiview": "gemini",
  "editor": "gemini",
};

interface BucketDetailPanelProps {
  image: BucketImage;
  onClose: () => void;
  onNavigate: (page: PageId) => void;
}

export function BucketDetailPanel({ image, onClose, onNavigate }: BucketDetailPanelProps) {
  const { addItem } = useArtboard();

  const handleRiffToMainstage = useCallback(() => {
    const page = toolPageMap[image.tool.toLowerCase()] || "character";
    onClose();
    onNavigate(page);

    const restoreData: Record<string, unknown> = { ...image.meta };
    restoreData._image_b64 = image.image_b64;
    restoreData._source_tool = page;

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("request-new-project", { detail: { storageKey: page } }));
    }, 100);

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("gallery-restore", { detail: restoreData }));
    }, 250);
  }, [image, onClose, onNavigate]);

  const handleAddToCanvas = useCallback(() => {
    const src = image.image_b64.startsWith("data:")
      ? image.image_b64
      : `data:image/png;base64,${image.image_b64}`;
    const img = new Image();
    img.onload = () => {
      addItem({
        type: "image",
        x: -img.naturalWidth / 2,
        y: -img.naturalHeight / 2,
        w: img.naturalWidth,
        h: img.naturalHeight,
        rotation: 0,
        content: src,
      });
    };
    img.src = src;
    onClose();
  }, [image, addItem, onClose]);

  const metaEntries = Object.entries(image.meta).filter(
    ([k]) => !k.startsWith("_") && k !== "image_b64" && k !== "full_image_b64",
  );

  return (
    <div
      className="fixed right-0 top-0 bottom-0 z-[9998] flex flex-col shadow-2xl"
      style={{
        width: 360,
        maxWidth: "45vw",
        background: "var(--color-card)",
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="flex-1 text-[13px] font-bold truncate" style={{ color: "var(--color-foreground)" }}>
          Shared Image Detail
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded cursor-pointer transition-colors hover:bg-[var(--color-hover)]"
          style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <div
            className="rounded-lg overflow-hidden mb-4"
            style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--color-border)" }}
          >
            <img
              src={
                image.image_b64.startsWith("data:")
                  ? image.image_b64
                  : `data:image/png;base64,${image.image_b64}`
              }
              alt=""
              className="w-full h-auto"
              draggable={false}
            />
          </div>

          <div className="flex items-center gap-2 mb-3">
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
              style={{
                background: "rgba(80,160,255,0.12)",
                color: "rgba(80,160,255,0.9)",
                border: "1px solid rgba(80,160,255,0.2)",
              }}
            >
              {image.tool}
            </span>
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              by <strong>{image.user}</strong>
            </span>
            <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              {new Date(image.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {image.prompt && (
            <div className="mb-4">
              <label className="text-[10px] font-medium uppercase tracking-wider block mb-1" style={{ color: "var(--color-text-muted)" }}>
                Prompt
              </label>
              <div
                className="text-[12px] leading-relaxed p-2.5 rounded"
                style={{ background: "var(--color-input-bg)", color: "var(--color-text-primary)", border: "1px solid var(--color-border)" }}
              >
                {image.prompt}
              </div>
            </div>
          )}

          {metaEntries.length > 0 && (
            <div className="mb-4">
              <label className="text-[10px] font-medium uppercase tracking-wider block mb-1.5" style={{ color: "var(--color-text-muted)" }}>
                Generation Settings
              </label>
              <div className="space-y-1">
                {metaEntries.map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 text-[11px]">
                    <span className="shrink-0 font-medium" style={{ color: "var(--color-text-secondary)", minWidth: 80 }}>
                      {key.replace(/_/g, " ")}
                    </span>
                    <span className="flex-1 break-words" style={{ color: "var(--color-text-primary)" }}>
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--color-border)" }}>
        <button
          onClick={handleRiffToMainstage}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-semibold cursor-pointer transition-colors"
          style={{
            background: "rgba(80,160,255,0.9)",
            border: "none",
            color: "#fff",
          }}
        >
          <Rocket className="h-3.5 w-3.5" />
          Riff Idea to Mainstage
        </button>
        <button
          onClick={handleAddToCanvas}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer transition-colors"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <ImagePlus className="h-3.5 w-3.5" />
          Add to Canvas
        </button>
      </div>
    </div>
  );
}
