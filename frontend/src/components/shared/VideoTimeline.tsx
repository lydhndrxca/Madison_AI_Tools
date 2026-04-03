import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Play, Pause, Repeat, Eye, EyeOff, ChevronDown, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoFrame {
  id: string;
  imageData: string;        // data URL (original extracted)
  editedData: string | null; // data URL after inpaint edits
  enabled: boolean;
  duration_ms: number;
}

export interface VideoTimelineProps {
  frames: VideoFrame[];
  currentIdx: number;
  onSeek: (idx: number) => void;
  onFramesChange: (frames: VideoFrame[]) => void;
  playing: boolean;
  onPlayPause: () => void;
  looping: boolean;
  onLoopToggle: () => void;
  speed: number;
  onSpeedChange: (s: number) => void;
  /** When true, the strip is collapsed to save space */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// ---------------------------------------------------------------------------
// Frame extraction from MP4 base64
// ---------------------------------------------------------------------------

const FPS_TARGET = 24;

export async function extractFrames(videoB64: string): Promise<VideoFrame[]> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = `data:video/mp4;base64,${videoB64}`;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Failed to load video"));
  });

  const duration = video.duration;
  if (!duration || !isFinite(duration)) throw new Error("Invalid video duration");

  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const totalFrames = Math.round(duration * FPS_TARGET);
  const frameDuration = 1000 / FPS_TARGET;
  const frames: VideoFrame[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i / FPS_TARGET;
    video.currentTime = time;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });

    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    frames.push({
      id: `f_${i}`,
      imageData: dataUrl,
      editedData: null,
      enabled: true,
      duration_ms: frameDuration,
    });
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Audio extraction from MP4 base64
// ---------------------------------------------------------------------------

const WAVEFORM_SAMPLES = 800;

export interface ExtractedAudio {
  audioBuffer: AudioBuffer;
  waveformPeaks: Float32Array;
}

export async function extractAudio(videoB64: string): Promise<ExtractedAudio | null> {
  try {
    const raw = atob(videoB64);
    const buf = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);

    const ctx = new AudioContext();
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(buf.buffer.slice(0));
    } catch {
      ctx.close();
      return null;
    }

    if (audioBuffer.length === 0 || audioBuffer.numberOfChannels === 0) {
      ctx.close();
      return null;
    }

    // Downsample to waveform peaks (absolute max per bucket)
    const channelData = audioBuffer.getChannelData(0);
    const peaks = new Float32Array(WAVEFORM_SAMPLES);
    const bucketSize = channelData.length / WAVEFORM_SAMPLES;
    for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.min(Math.floor((i + 1) * bucketSize), channelData.length);
      let max = 0;
      for (let j = start; j < end; j++) {
        const abs = Math.abs(channelData[j]);
        if (abs > max) max = abs;
      }
      peaks[i] = max;
    }

    ctx.close();
    return { audioBuffer, waveformPeaks: peaks };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEEDS = [0.25, 0.5, 1, 2];

function formatTime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const frac = Math.floor((ms % 1000) / 100);
  return `${secs}.${frac}s`;
}

function getFrameSrc(f: VideoFrame): string {
  return f.editedData ?? f.imageData;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VideoTimeline({
  frames, currentIdx, onSeek, onFramesChange,
  playing, onPlayPause, looping, onLoopToggle,
  speed, onSpeedChange,
  collapsed = false, onToggleCollapse,
}: VideoTimelineProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // No auto-scroll — user controls scroll position manually

  const totalMs = useMemo(() => {
    let ms = 0;
    for (const f of frames) if (f.enabled) ms += f.duration_ms;
    return ms;
  }, [frames]);

  const currentMs = useMemo(() => {
    let ms = 0;
    for (let i = 0; i < currentIdx; i++) if (frames[i]?.enabled) ms += frames[i].duration_ms;
    return ms;
  }, [frames, currentIdx]);

  const toggleFrame = useCallback((idx: number) => {
    const next = [...frames];
    next[idx] = { ...next[idx], enabled: !next[idx].enabled };
    onFramesChange(next);
  }, [frames, onFramesChange]);

  const nextSpeed = useCallback(() => {
    const i = SPEEDS.indexOf(speed);
    onSpeedChange(SPEEDS[(i + 1) % SPEEDS.length]);
  }, [speed, onSpeedChange]);

  if (frames.length === 0) return null;

  const CollapseIcon = collapsed ? ChevronRight : ChevronDown;

  return (
    <div className="shrink-0 flex flex-col" style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-card)" }}>
      {/* Header + Controls row */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {onToggleCollapse && (
          <button
            className="p-0.5 rounded cursor-pointer"
            style={{ background: "none", border: "none", color: "var(--color-text-muted)" }}
            onClick={onToggleCollapse}
            title={collapsed ? "Expand frame strip" : "Collapse frame strip"}
          >
            <CollapseIcon size={12} />
          </button>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>Frames</span>
        <button
          className="p-1 rounded cursor-pointer"
          style={{ background: "none", border: "none", color: "var(--color-text-primary)" }}
          onClick={onPlayPause}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          className="p-1 rounded cursor-pointer"
          style={{ background: "none", border: "none", color: looping ? "var(--color-accent)" : "var(--color-text-muted)" }}
          onClick={onLoopToggle}
          title={looping ? "Loop on" : "Loop off"}
        >
          <Repeat size={14} />
        </button>
        <button
          className="px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          onClick={nextSpeed}
          title="Playback speed"
        >
          {speed}x
        </button>
        <span className="text-[10px] ml-auto font-mono" style={{ color: "var(--color-text-muted)" }}>
          {formatTime(currentMs)} / {formatTime(totalMs)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>
          {currentIdx + 1}/{frames.length}
        </span>
      </div>

      {/* Thumbnail strip (collapsible) */}
      {!collapsed && (
        <div
          ref={stripRef}
          className="flex gap-1 px-2 pb-2 pt-0.5 overflow-x-auto"
          style={{ scrollbarWidth: "thin" }}
        >
          {frames.map((f, i) => (
            <button
              key={f.id}
              ref={(el) => { if (el) thumbRefs.current.set(i, el); else thumbRefs.current.delete(i); }}
              className="shrink-0 rounded overflow-hidden cursor-pointer relative group"
              style={{
                width: 88,
                height: 54,
                border: i === currentIdx ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
                opacity: f.enabled ? 1 : 0.3,
                background: "#111",
              }}
              onClick={() => onSeek(i)}
              title={`Frame ${i + 1}${f.editedData ? " (edited)" : ""}${!f.enabled ? " (disabled)" : ""}`}
            >
              <img
                src={getFrameSrc(f)}
                alt=""
                className="w-full h-full object-cover"
                draggable={false}
              />
              {/* Frame number badge */}
              <span
                className="absolute top-0.5 left-0.5 text-[8px] font-mono px-1 rounded"
                style={{ background: "rgba(0,0,0,.65)", color: "rgba(255,255,255,.7)" }}
              >
                {i + 1}
              </span>
              {f.editedData && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full" style={{ background: "var(--color-accent)" }} />
              )}
              <button
                className="absolute bottom-0 left-0 p-0.5 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "rgba(0,0,0,.7)", border: "none", color: f.enabled ? "#fff" : "#888", lineHeight: 0 }}
                onClick={(e) => { e.stopPropagation(); toggleFrame(i); }}
                title={f.enabled ? "Disable frame" : "Enable frame"}
              >
                {f.enabled ? <Eye size={10} /> : <EyeOff size={10} />}
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
