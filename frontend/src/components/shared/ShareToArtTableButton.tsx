import { useCallback } from "react";
import { Share2 } from "lucide-react";

interface ShareToArtTableButtonProps {
  imageB64: string | null;
  tool: string;
  prompt: string;
  meta?: Record<string, unknown>;
}

export function ShareToArtTableButton({ imageB64, tool, prompt, meta }: ShareToArtTableButtonProps) {
  const handleShare = useCallback(() => {
    if (!imageB64) return;
    const raw = imageB64.replace(/^data:image\/\w+;base64,/, "");
    window.dispatchEvent(
      new CustomEvent("share-to-artboard", {
        detail: { image_b64: raw, tool, prompt, meta: meta || {} },
      }),
    );
  }, [imageB64, tool, prompt, meta]);

  if (!imageB64) return null;

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors"
      style={{
        background: "rgba(80,160,255,0.12)",
        border: "1px solid rgba(80,160,255,0.25)",
        color: "rgba(80,160,255,0.9)",
      }}
      title="Share this image to the Art Table bucket"
    >
      <Share2 className="h-3 w-3" />
      Share to Art Table
    </button>
  );
}
