import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderPlus,
  Trash2,
  Pencil,
  ImagePlus,
  X,
  FolderOpen,
  ArrowLeft,
  Eye,
  EyeOff,
} from "lucide-react";
import { apiFetch } from "@/hooks/useApi";

/* ── Types ────────────────────────────────────────────────────── */

interface FolderInfo {
  name: string;
  guidance_text: string;
  image_count: number;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
}

interface ImageInfo {
  filename: string;
  data_url: string;
  disabled: boolean;
}

/* ── StyleLibraryPage ─────────────────────────────────────────── */

export function StyleLibraryPage() {
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [subfolders, setSubfolders] = useState<string[]>([]);
  const [activeSubfolder, setActiveSubfolder] = useState<string>("");
  const [images, setImages] = useState<ImageInfo[]>([]);
  const [guidance, setGuidance] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const guidanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Fetch folders ─────────────────────────────────────────── */

  const loadFolders = useCallback(async () => {
    try {
      const res = await apiFetch<FolderInfo[]>("/styles/folders");
      setFolders(res);
    } catch (e) {
      console.error("[StyleLibrary] Failed to load folders:", e);
    }
  }, []);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  /* ── Fetch images when folder/subfolder changes ────────────── */

  const loadImages = useCallback(async (folder: string, sub: string) => {
    try {
      const qs = sub ? `?subfolder=${encodeURIComponent(sub)}` : "";
      const res = await apiFetch<ImageInfo[]>(`/styles/folders/${encodeURIComponent(folder)}/images${qs}`);
      setImages(res);
    } catch (e) {
      console.error("[StyleLibrary] Failed to load images:", e);
      setImages([]);
    }
  }, []);

  const loadSubfolders = useCallback(async (folder: string) => {
    try {
      const res = await apiFetch<string[]>(`/styles/folders/${encodeURIComponent(folder)}/subfolders`);
      setSubfolders(res);
    } catch {
      setSubfolders([]);
    }
  }, []);

  const handleSelectFolder = useCallback((name: string) => {
    setSelectedFolder(name);
    setActiveSubfolder("");
    setSelectedImage(null);
    const f = folders.find((f) => f.name === name);
    setGuidance(f?.guidance_text ?? "");
    loadImages(name, "");
    loadSubfolders(name);
  }, [folders, loadImages, loadSubfolders]);

  const handleSelectSubfolder = useCallback((sub: string) => {
    setActiveSubfolder(sub);
    setSelectedImage(null);
    if (selectedFolder) loadImages(selectedFolder, sub);
  }, [selectedFolder, loadImages]);

  /* ── Folder CRUD ───────────────────────────────────────────── */

  const handleNewFolder = useCallback(async () => {
    const name = prompt("New style folder name:");
    if (!name?.trim()) return;
    try {
      await apiFetch("/styles/folders", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      await loadFolders();
      setSelectedFolder(name.trim());
      setGuidance("");
      setImages([]);
      setSubfolders([]);
    } catch (e) { console.error(e); }
  }, [loadFolders]);

  const handleDeleteFolder = useCallback(async () => {
    if (!selectedFolder) return;
    if (!confirm(`Delete style folder "${selectedFolder}" and all its images?`)) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}`, { method: "DELETE" });
      setSelectedFolder(null);
      setImages([]);
      setSubfolders([]);
      setGuidance("");
      await loadFolders();
    } catch (e) { console.error(e); }
  }, [selectedFolder, loadFolders]);

  const handleRenameFolder = useCallback(async () => {
    if (!selectedFolder) return;
    const newName = prompt("Rename folder:", selectedFolder);
    if (!newName?.trim() || newName.trim() === selectedFolder) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}`, {
        method: "PATCH",
        body: JSON.stringify({ new_name: newName.trim() }),
      });
      setSelectedFolder(newName.trim());
      await loadFolders();
    } catch (e) { console.error(e); }
  }, [selectedFolder, loadFolders]);

  /* ── Guidance ──────────────────────────────────────────────── */

  const handleGuidanceChange = useCallback((text: string) => {
    setGuidance(text);
    if (guidanceTimerRef.current) clearTimeout(guidanceTimerRef.current);
    guidanceTimerRef.current = setTimeout(async () => {
      if (!selectedFolder) return;
      try {
        await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}/guidance`, {
          method: "PUT",
          body: JSON.stringify({ guidance_text: text }),
        });
      } catch (e) { console.error(e); }
    }, 600);
  }, [selectedFolder]);

  /* ── Images ────────────────────────────────────────────────── */

  const handleAddImages = useCallback(() => {
    if (!selectedFolder) { alert("Select or create a folder first."); return; }
    fileInputRef.current?.click();
  }, [selectedFolder]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedFolder || !e.target.files?.length) return;
    const items: { filename: string; data_url: string }[] = [];
    for (const file of Array.from(e.target.files)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      items.push({ filename: file.name, data_url: dataUrl });
    }
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}/images`, {
        method: "POST",
        body: JSON.stringify(items),
      });
      loadImages(selectedFolder, activeSubfolder);
      loadFolders();
    } catch (err) { console.error(err); }
    e.target.value = "";
  }, [selectedFolder, activeSubfolder, loadImages, loadFolders]);

  const handleRemoveImage = useCallback(async () => {
    if (!selectedFolder || !selectedImage) return;
    const qs = activeSubfolder ? `?subfolder=${encodeURIComponent(activeSubfolder)}` : "";
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}/images/${encodeURIComponent(selectedImage)}${qs}`, { method: "DELETE" });
      setSelectedImage(null);
      loadImages(selectedFolder, activeSubfolder);
      loadFolders();
    } catch (e) { console.error(e); }
  }, [selectedFolder, selectedImage, activeSubfolder, loadImages, loadFolders]);

  const handleToggleDisabled = useCallback(async (filename: string) => {
    if (!selectedFolder) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}/toggle-disabled`, {
        method: "POST",
        body: JSON.stringify({ filename, subfolder: activeSubfolder }),
      });
      loadImages(selectedFolder, activeSubfolder);
    } catch (e) { console.error(e); }
  }, [selectedFolder, activeSubfolder, loadImages]);

  /* ── Render ────────────────────────────────────────────────── */

  const currentFolder = folders.find((f) => f.name === selectedFolder);

  return (
    <div className="flex h-full gap-0 overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* ── Left: Folder list ────────────────────────────────── */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: 220, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        <div
          className="flex items-center gap-1.5 px-3 shrink-0"
          style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--color-text-muted)" }}>
            Style Folders
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {folders.map((f) => (
            <button
              key={f.name}
              onClick={() => handleSelectFolder(f.name)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors cursor-pointer"
              style={{
                background: selectedFolder === f.name ? "var(--color-hover)" : "transparent",
                color: selectedFolder === f.name ? "var(--color-foreground)" : "var(--color-text-secondary)",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              {f.thumbnail ? (
                <img src={f.thumbnail} alt="" className="shrink-0 rounded object-cover" style={{ width: 36, height: 36 }} />
              ) : (
                <div
                  className="shrink-0 rounded flex items-center justify-center"
                  style={{ width: 36, height: 36, background: "var(--color-hover)" }}
                >
                  <FolderOpen className="h-4 w-4" style={{ color: "var(--color-text-muted)" }} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium truncate">{f.name}</div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {f.image_count} image{f.image_count !== 1 ? "s" : ""}
                </div>
              </div>
            </button>
          ))}
          {folders.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              No style folders yet
            </div>
          )}
        </div>

        <div
          className="flex gap-1 px-2 py-2 shrink-0"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            onClick={handleNewFolder}
            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-medium transition-colors cursor-pointer"
            style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
            title="New Folder"
          >
            <FolderPlus className="h-3.5 w-3.5" /> New
          </button>
          <button
            onClick={handleRenameFolder}
            disabled={!selectedFolder}
            className="px-2 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}
            title="Rename"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDeleteFolder}
            disabled={!selectedFolder}
            className="px-2 py-1.5 rounded text-[11px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "var(--color-hover)", color: "var(--color-destructive, #e55)", border: "none" }}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Middle: Trained element subfolders ────────────────── */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: 170, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        <div
          className="flex items-center px-3 shrink-0"
          style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
            Trained Elements
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {selectedFolder && (
            <button
              onClick={() => handleSelectSubfolder("")}
              className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] transition-colors cursor-pointer"
              style={{
                background: activeSubfolder === "" ? "var(--color-hover)" : "transparent",
                color: activeSubfolder === "" ? "var(--color-foreground)" : "var(--color-text-secondary)",
                border: "none",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              Main Folder
            </button>
          )}
          {subfolders.map((sub) => {
            const display = sub.replace(/_styles$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            return (
              <button
                key={sub}
                onClick={() => handleSelectSubfolder(sub)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] transition-colors cursor-pointer"
                style={{
                  background: activeSubfolder === sub ? "var(--color-hover)" : "transparent",
                  color: activeSubfolder === sub ? "var(--color-foreground)" : "var(--color-text-secondary)",
                  border: "none",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                {display}
              </button>
            );
          })}
          {!selectedFolder && (
            <div className="px-3 py-6 text-center text-[10px] italic" style={{ color: "var(--color-text-muted)" }}>
              Select a folder to see trained element subfolders
            </div>
          )}
          {selectedFolder && subfolders.length === 0 && (
            <div className="px-3 py-4 text-[10px] italic" style={{ color: "var(--color-text-muted)" }}>
              Sub-folders created by generation appear here.
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Image grid + guidance ─────────────────────── */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        {/* Header + action buttons */}
        <div
          className="flex items-center gap-2 px-3 shrink-0"
          style={{ height: 36, borderBottom: "1px solid var(--color-border)", background: "var(--color-card)" }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--color-text-muted)" }}>
            {selectedFolder
              ? `Images — ${currentFolder?.name ?? selectedFolder}${activeSubfolder ? ` / ${activeSubfolder.replace(/_styles$/, "")}` : ""}`
              : "Select a folder"}
          </span>
          <span className="text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>
            {selectedFolder ? `${images.length}/16` : ""}
          </span>
          <button
            onClick={handleAddImages}
            disabled={!selectedFolder}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
          >
            <ImagePlus className="h-3.5 w-3.5" /> Add Images
          </button>
          <button
            onClick={handleRemoveImage}
            disabled={!selectedImage}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}
          >
            <X className="h-3.5 w-3.5" /> Remove
          </button>
        </div>

        {/* Image grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {!selectedFolder ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <FolderOpen className="mx-auto mb-3 h-12 w-12" style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                <p className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
                  Select a style folder or create a new one
                </p>
              </div>
            </div>
          ) : images.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <ImagePlus className="mx-auto mb-3 h-10 w-10" style={{ color: "var(--color-text-muted)", opacity: 0.4 }} />
                <p className="text-[13px] mb-2" style={{ color: "var(--color-text-muted)" }}>
                  No images in this folder
                </p>
                <button
                  onClick={handleAddImages}
                  className="text-[12px] px-3 py-1.5 rounded cursor-pointer"
                  style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
                >
                  + Add Images
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                <div
                  key={img.filename}
                  className="relative group cursor-pointer rounded transition-all"
                  style={{
                    width: 104,
                    height: 104,
                    border: selectedImage === img.filename
                      ? "2px solid var(--color-accent)"
                      : "2px solid transparent",
                    opacity: img.disabled ? 0.4 : 1,
                  }}
                  onClick={() => setSelectedImage(img.filename === selectedImage ? null : img.filename)}
                  onDoubleClick={() => setPreviewImage(img.data_url)}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      handleToggleDisabled(img.filename);
                    }
                  }}
                  title={`${img.filename}${img.disabled ? " (disabled)" : ""}\nDouble-click to preview\nMiddle-click to toggle disabled`}
                >
                  <img
                    src={img.data_url}
                    alt={img.filename}
                    className="w-full h-full object-cover rounded"
                    draggable={false}
                  />
                  {img.disabled && (
                    <div
                      className="absolute bottom-0 left-0 right-0 flex items-center justify-center py-0.5 rounded-b text-[8px] font-bold uppercase tracking-wider"
                      style={{ background: "rgba(0,0,0,0.7)", color: "#ff3c3c" }}
                    >
                      Disabled
                    </div>
                  )}
                  <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleDisabled(img.filename); }}
                      className="p-0.5 rounded cursor-pointer"
                      style={{ background: "rgba(0,0,0,0.7)", color: "#ccc", border: "none" }}
                      title={img.disabled ? "Enable" : "Disable"}
                    >
                      {img.disabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    </button>
                  </div>
                  <div
                    className="absolute bottom-0 left-0 right-0 truncate text-center text-[8px] py-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-b"
                    style={{ background: "rgba(0,0,0,0.7)", color: "var(--color-text-muted)" }}
                  >
                    {img.filename}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Guidance text */}
        {selectedFolder && (
          <div
            className="shrink-0 px-3 py-2 flex items-start gap-2"
            style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}
          >
            <span
              className="text-[11px] font-semibold shrink-0 pt-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Style Guidance:
            </span>
            <textarea
              value={guidance}
              onChange={(e) => handleGuidanceChange(e.target.value)}
              placeholder="Describe the visual style for Gemini… e.g. bold outlines, gritty 90s palette, halftone shading"
              className="flex-1 resize-none text-[12px] px-2 py-1.5 rounded outline-none"
              style={{
                height: 52,
                background: "var(--color-input-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
        )}
      </div>

      {/* Hidden file input for image uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/bmp,image/webp"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Full-screen preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={() => setPreviewImage(null)}
        >
          <img
            src={previewImage}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 rounded-full cursor-pointer"
            style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "none" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}
