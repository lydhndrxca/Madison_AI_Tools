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
  Plus,
  Check,
  Clipboard,
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
  category: string;
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
  const [categoryFilter, setCategoryFilter] = useState<"all" | "general" | "ui">("all");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  const guidanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

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

  const handleStartNewFolder = useCallback(() => {
    setNewFolderName("");
    setShowNewInput(true);
    requestAnimationFrame(() => newFolderInputRef.current?.focus());
  }, []);

  const handleCommitNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) { setShowNewInput(false); return; }
    const cat = categoryFilter === "all" ? "general" : categoryFilter;
    try {
      await apiFetch("/styles/folders", { method: "POST", body: JSON.stringify({ name, category: cat }) });
      await loadFolders();
      setSelectedFolder(name);
      setGuidance("");
      setImages([]);
      setSubfolders([]);
    } catch (e) { console.error("[StyleLibrary] Failed to create folder:", e); }
    setShowNewInput(false);
    setNewFolderName("");
  }, [newFolderName, loadFolders, categoryFilter]);

  const handleSetCategory = useCallback(async (cat: string) => {
    if (!selectedFolder) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}/category`, {
        method: "PUT",
        body: JSON.stringify({ category: cat }),
      });
      await loadFolders();
    } catch (e) { console.error(e); }
  }, [selectedFolder, loadFolders]);

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
    const uploads: { filename: string; data_url: string }[] = [];
    for (const file of Array.from(e.target.files)) {
      const dataUrl = await readFileAsDataUrl(file);
      uploads.push({ filename: file.name, data_url: dataUrl });
    }
    await uploadDataUrls(uploads);
    e.target.value = "";
  }, [selectedFolder, uploadDataUrls, readFileAsDataUrl]);

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

  /* ── Shared image upload helper ─────────────────────────────── */

  const uploadDataUrls = useCallback(async (items: { filename: string; data_url: string }[]) => {
    if (!selectedFolder || items.length === 0) return;
    try {
      await apiFetch(`/styles/folders/${encodeURIComponent(selectedFolder)}/images`, {
        method: "POST",
        body: JSON.stringify(items),
      });
      loadImages(selectedFolder, activeSubfolder);
      loadFolders();
    } catch (e) { console.error("[StyleLibrary] Upload failed:", e); }
  }, [selectedFolder, activeSubfolder, loadImages, loadFolders]);

  const readFileAsDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }, []);

  /* ── Clipboard paste ───────────────────────────────────────── */

  const handlePasteImages = useCallback(async () => {
    if (!selectedFolder) return;
    try {
      const clipItems = await navigator.clipboard.read();
      const uploads: { filename: string; data_url: string }[] = [];
      for (const ci of clipItems) {
        const imgType = ci.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await ci.getType(imgType);
          const ext = imgType.split("/")[1] || "png";
          const dataUrl = await readFileAsDataUrl(new File([blob], `pasted_${Date.now()}.${ext}`));
          uploads.push({ filename: `pasted_${Date.now()}_${uploads.length}.${ext}`, data_url: dataUrl });
        }
      }
      if (uploads.length > 0) await uploadDataUrls(uploads);
    } catch { /* clipboard read may fail if no permission */ }
  }, [selectedFolder, uploadDataUrls, readFileAsDataUrl]);

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (!selectedFolder) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (!e.clipboardData) return;

      const files: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length === 0) return;
      e.preventDefault();

      const uploads: { filename: string; data_url: string }[] = [];
      for (const file of files) {
        const dataUrl = await readFileAsDataUrl(file);
        const ext = file.type.split("/")[1] || "png";
        uploads.push({ filename: `pasted_${Date.now()}_${uploads.length}.${ext}`, data_url: dataUrl });
      }
      await uploadDataUrls(uploads);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [selectedFolder, uploadDataUrls, readFileAsDataUrl]);

  /* ── Drag and drop ─────────────────────────────────────────── */

  const [draggingOver, setDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (selectedFolder && e.dataTransfer.types.some((t) => t === "Files" || t.startsWith("image/"))) {
      setDraggingOver(true);
    }
  }, [selectedFolder]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDraggingOver(false); }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = selectedFolder ? "copy" : "none";
  }, [selectedFolder]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDraggingOver(false);
    if (!selectedFolder) return;

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    const uploads: { filename: string; data_url: string }[] = [];
    for (const file of files) {
      const dataUrl = await readFileAsDataUrl(file);
      uploads.push({ filename: file.name, data_url: dataUrl });
    }
    await uploadDataUrls(uploads);
  }, [selectedFolder, uploadDataUrls, readFileAsDataUrl]);

  /* ── Render ────────────────────────────────────────────────── */

  const filteredFolders = categoryFilter === "all"
    ? folders
    : folders.filter((f) => f.category === categoryFilter);
  const currentFolder = folders.find((f) => f.name === selectedFolder);

  return (
    <div className="flex h-full gap-0 overflow-hidden" style={{ background: "var(--color-background)" }}>
      {/* ── Left: Folder list ────────────────────────────────── */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: 240, borderRight: "1px solid var(--color-border)", background: "var(--color-card)" }}
      >
        {/* Header + New button */}
        <div
          className="flex items-center gap-1.5 px-3 shrink-0"
          style={{ height: 36, borderBottom: "1px solid var(--color-border)" }}
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider flex-1" style={{ color: "var(--color-text-muted)" }}>
            Style Folders
          </span>
          <button
            onClick={handleStartNewFolder}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer transition-colors"
            style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
            title="Create New Folder"
          >
            <Plus className="h-3 w-3" /> New
          </button>
        </div>

        {/* Folder actions toolbar (visible when a folder is selected) */}
        {selectedFolder && (
          <div
            className="flex items-center gap-1 px-2 py-1.5 shrink-0"
            style={{ borderBottom: "1px solid var(--color-border)", background: "rgba(255,255,255,0.02)" }}
          >
            <span className="text-[9px] uppercase tracking-wider shrink-0 mr-auto" style={{ color: "var(--color-text-muted)" }}>
              Actions
            </span>
            <button
              onClick={handleRenameFolder}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] cursor-pointer transition-colors"
              style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}
              title="Rename folder"
            >
              <Pencil className="h-3 w-3" /> Rename
            </button>
            <button
              onClick={handleDeleteFolder}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] cursor-pointer transition-colors"
              style={{ background: "var(--color-hover)", color: "var(--color-destructive, #e55)", border: "none" }}
              title="Delete folder"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            <button
              onClick={() => handleSetCategory(currentFolder?.category === "ui" ? "general" : "ui")}
              className="px-1.5 py-1 rounded text-[9px] font-bold cursor-pointer transition-colors"
              style={{
                background: currentFolder?.category === "ui" ? "rgba(94,156,224,0.15)" : "rgba(78,201,160,0.15)",
                color: currentFolder?.category === "ui" ? "#5e9ce0" : "#4ec9a0",
                border: `1px solid ${currentFolder?.category === "ui" ? "rgba(94,156,224,0.3)" : "rgba(78,201,160,0.3)"}`,
              }}
              title={currentFolder?.category === "ui" ? "Move to General library" : "Move to UI library"}
            >
              {currentFolder?.category === "ui" ? "UI" : "GEN"}
            </button>
          </div>
        )}

        {/* Category tabs — prominent segmented style */}
        <div className="shrink-0 px-2 pt-2 pb-1" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <div className="grid grid-cols-2 gap-1.5 mb-1.5">
            {(["general", "ui"] as const).map((cat) => {
              const isActive = categoryFilter === cat;
              const count = folders.filter((f) => f.category === cat).length;
              const isGeneral = cat === "general";
              const activeColor = isGeneral ? "#4ec9a0" : "#5e9ce0";
              const activeBg = isGeneral ? "rgba(78,201,160,0.12)" : "rgba(94,156,224,0.12)";
              const activeBorder = isGeneral ? "rgba(78,201,160,0.45)" : "rgba(94,156,224,0.45)";
              return (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className="flex flex-col items-center py-2 rounded cursor-pointer transition-all"
                  style={{
                    background: isActive ? activeBg : "rgba(255,255,255,0.03)",
                    border: isActive ? `1.5px solid ${activeBorder}` : "1.5px solid var(--color-border)",
                    color: isActive ? activeColor : "var(--color-text-muted)",
                  }}
                >
                  <span className="text-[12px] font-bold tracking-wide">{isGeneral ? "General" : "UI"}</span>
                  <span className="text-[9px] mt-0.5 opacity-70">{count} folder{count !== 1 ? "s" : ""}</span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setCategoryFilter("all")}
            className="w-full text-center text-[9px] py-0.5 cursor-pointer transition-colors rounded"
            style={{
              background: categoryFilter === "all" ? "var(--color-hover)" : "transparent",
              color: categoryFilter === "all" ? "var(--color-foreground)" : "var(--color-text-muted)",
              border: "none",
              fontWeight: categoryFilter === "all" ? 600 : 400,
            }}
          >
            Show All ({folders.length})
          </button>
        </div>

        {/* Inline new-folder input */}
        {showNewInput && (
          <div
            className="flex items-center gap-1 px-2 py-1.5 shrink-0"
            style={{ borderBottom: "1px solid var(--color-border)", background: "rgba(78,201,160,0.06)" }}
          >
            <FolderPlus className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            <input
              ref={newFolderInputRef}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleCommitNewFolder(); }
                if (e.key === "Escape") { setShowNewInput(false); setNewFolderName(""); }
              }}
              onBlur={() => { if (!newFolderName.trim()) { setShowNewInput(false); } }}
              placeholder="Folder name…"
              className="flex-1 min-w-0 px-1.5 py-1 text-[11px] rounded outline-none"
              style={{
                background: "var(--color-input-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <button
              onClick={handleCommitNewFolder}
              disabled={!newFolderName.trim()}
              className="p-1 rounded cursor-pointer transition-colors disabled:opacity-30"
              style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
              title="Create"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setShowNewInput(false); setNewFolderName(""); }}
              className="p-1 rounded cursor-pointer transition-colors"
              style={{ background: "var(--color-hover)", color: "var(--color-text-muted)", border: "none" }}
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto">
          {filteredFolders.map((f) => (
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
                <div className="flex items-center gap-1">
                  <span className="text-[12px] font-medium truncate">{f.name}</span>
                  <span
                    className="shrink-0 px-1 py-0 rounded text-[8px] font-bold uppercase"
                    style={{
                      background: f.category === "ui" ? "rgba(94,156,224,0.15)" : "rgba(78,201,160,0.15)",
                      color: f.category === "ui" ? "#5e9ce0" : "#4ec9a0",
                      border: `1px solid ${f.category === "ui" ? "rgba(94,156,224,0.3)" : "rgba(78,201,160,0.3)"}`,
                    }}
                  >
                    {f.category === "ui" ? "UI" : "GEN"}
                  </span>
                </div>
                <div className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {f.image_count} image{f.image_count !== 1 ? "s" : ""}
                </div>
              </div>
            </button>
          ))}
          {filteredFolders.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              {categoryFilter === "all" ? "No style folders yet" : `No ${categoryFilter === "ui" ? "UI" : "General"} folders yet`}
            </div>
          )}
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
          <span className="text-[11px] font-semibold uppercase tracking-wider shrink-0" style={{ color: "var(--color-text-muted)" }}>
            {selectedFolder
              ? `Images — ${currentFolder?.name ?? selectedFolder}${activeSubfolder ? ` / ${activeSubfolder.replace(/_styles$/, "")}` : ""}`
              : "Select a folder"}
          </span>
          <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--color-text-muted)" }}>
            {selectedFolder ? `${images.length}/16` : ""}
          </span>
          <button
            onClick={handleAddImages}
            disabled={!selectedFolder}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
            title="Open images from disk"
          >
            <ImagePlus className="h-3.5 w-3.5" /> Open
          </button>
          <button
            onClick={handlePasteImages}
            disabled={!selectedFolder}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}
            title="Paste image from clipboard (Ctrl+V)"
          >
            <Clipboard className="h-3.5 w-3.5" /> Paste
          </button>
          <button
            onClick={handleRemoveImage}
            disabled={!selectedImage}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            style={{ background: "var(--color-hover)", color: "var(--color-text-secondary)", border: "none" }}
          >
            <X className="h-3.5 w-3.5" /> Remove
          </button>
          <div className="flex-1" />
        </div>

        {/* Image grid (drop zone) */}
        <div
          className="flex-1 overflow-y-auto p-3 relative"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {draggingOver && selectedFolder && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-lg pointer-events-none"
              style={{
                background: "rgba(78,201,160,0.08)",
                border: "2px dashed rgba(78,201,160,0.5)",
                margin: 4,
              }}
            >
              <div className="text-center">
                <ImagePlus className="mx-auto mb-2 h-8 w-8" style={{ color: "#4ec9a0" }} />
                <p className="text-[13px] font-medium" style={{ color: "#4ec9a0" }}>Drop images here</p>
              </div>
            </div>
          )}

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
                <p className="text-[13px] mb-1" style={{ color: "var(--color-text-muted)" }}>
                  No images in this folder
                </p>
                <p className="text-[11px] mb-3" style={{ color: "var(--color-text-muted)", opacity: 0.7 }}>
                  Drop images, paste (Ctrl+V), or click to add
                </p>
                <button
                  onClick={handleAddImages}
                  className="text-[12px] px-3 py-1.5 rounded cursor-pointer"
                  style={{ background: "var(--color-accent)", color: "var(--color-foreground)", border: "none" }}
                >
                  + Open Images
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
