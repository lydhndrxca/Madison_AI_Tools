import { useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useArtboard, type BucketImage } from "@/hooks/ArtboardContext";
import type { PageId } from "@/app";
import { BucketDetailPanel } from "./BucketDetailPanel";

interface BucketSidebarProps {
  onNavigate: (page: PageId) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

export function BucketSidebar({ onNavigate, collapsed, setCollapsed }: BucketSidebarProps) {
  const { buckets, roomUsers, mode } = useArtboard();
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set(["__all__"]));
  const [selectedImage, setSelectedImage] = useState<BucketImage | null>(null);

  const toggleUser = (name: string) => {
    setExpandedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allUsers = Object.keys(buckets);
  if (mode === "shared") {
    for (const u of roomUsers) {
      if (!allUsers.includes(u.name)) allUsers.push(u.name);
    }
  }

  return (
    <>
      <aside
        className={cn(
          "flex shrink-0 border-r transition-[width] duration-200 ease-in-out overflow-hidden",
          collapsed ? "w-[52px]" : "w-[268px]",
        )}
        style={{ borderColor: "var(--color-border)", background: "var(--color-card)" }}
      >
        {!collapsed && (
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <div className="flex h-11 items-center shrink-0 px-3 gap-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <button
                onClick={() => onNavigate("character")}
                className="flex items-center gap-1.5 text-[11px] font-medium cursor-pointer rounded px-1.5 py-1 transition-colors hover:bg-[var(--color-hover)]"
                style={{ background: "transparent", border: "none", color: "var(--color-text-secondary)" }}
                title="Back to tools"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Tools
              </button>
              <span className="flex-1" />
              <span className="text-[13px] font-bold tracking-tight" style={{ color: "var(--color-foreground)" }}>
                Art Table
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2">
              {mode !== "shared" && allUsers.length === 0 && (
                <div className="text-[11px] px-2 py-6 text-center" style={{ color: "var(--color-text-muted)" }}>
                  Share your Art Table or use the<br />
                  <strong>"Share to Art Table"</strong> button<br />
                  on any tool's mainstage to add images here.
                </div>
              )}

              {mode === "shared" && allUsers.length === 0 && (
                <div className="text-[11px] px-2 py-6 text-center" style={{ color: "var(--color-text-muted)" }}>
                  No shared images yet.<br />
                  Use the <strong>"Share to Art Table"</strong> button<br />
                  on any tool's mainstage.
                </div>
              )}

              {allUsers.map((userName) => {
                const userImages = buckets[userName] || [];
                const isExpanded = expandedUsers.has(userName) || expandedUsers.has("__all__");
                const userColor = roomUsers.find((u) => u.name === userName)?.color || "var(--color-text-secondary)";

                return (
                  <div key={userName} className="mb-2">
                    <button
                      onClick={() => toggleUser(userName)}
                      className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded transition-colors cursor-pointer hover:bg-[var(--color-hover)]"
                      style={{ background: "transparent", border: "none", color: "var(--color-text-primary)" }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: userColor }}
                      />
                      <span className="text-[12px] font-semibold flex-1 truncate">{userName}</span>
                      <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                        {userImages.length}
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                      ) : (
                        <ChevronDown className="h-3 w-3 shrink-0" style={{ color: "var(--color-text-muted)" }} />
                      )}
                    </button>

                    {isExpanded && userImages.length > 0 && (
                      <div className="grid grid-cols-3 gap-1 px-1 pt-1">
                        {userImages.map((img) => (
                          <button
                            key={img.id}
                            onClick={() => setSelectedImage(img)}
                            className="aspect-square rounded overflow-hidden cursor-pointer transition-all hover:ring-1 hover:ring-[rgba(80,160,255,0.5)]"
                            style={{
                              background: "var(--color-input-bg)",
                              border: selectedImage?.id === img.id ? "2px solid rgba(80,160,255,0.8)" : "1px solid var(--color-border)",
                              padding: 0,
                            }}
                            title={img.prompt || img.tool}
                          >
                            <img
                              src={`data:image/png;base64,${img.image_b64}`}
                              alt=""
                              className="w-full h-full object-cover"
                              draggable={false}
                            />
                          </button>
                        ))}
                      </div>
                    )}

                    {isExpanded && userImages.length === 0 && (
                      <div className="text-[10px] px-3 py-2" style={{ color: "var(--color-text-muted)" }}>
                        No shared images yet
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {mode === "shared" && (
              <div className="px-3 py-2 text-[10px]" style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
                {roomUsers.length} user{roomUsers.length !== 1 ? "s" : ""} connected
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setCollapsed(!collapsed)}
          className="shrink-0 w-[52px] flex flex-col items-center justify-center transition-colors cursor-pointer"
          style={{
            border: "none",
            borderLeft: collapsed ? "none" : "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text-muted)",
          }}
          title={collapsed ? "Show bucket panel" : "Hide bucket panel"}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </aside>

      {selectedImage && (
        <BucketDetailPanel
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
}
