import { useState, useEffect, useRef, useCallback } from "react";
import { X, Mic } from "lucide-react";
import { useVoiceToText, getSavedDeviceId } from "@/hooks/useVoiceToText";

interface AudioSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const DEVICE_STORAGE_KEY = "madison-audio-device-id";

function saveDeviceId(id: string) {
  try { localStorage.setItem(DEVICE_STORAGE_KEY, id); } catch { /* */ }
}

const LANGUAGES = [
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "ru-RU", label: "Russian" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Mandarin)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "ar-SA", label: "Arabic" },
  { code: "hi-IN", label: "Hindi" },
  { code: "nl-NL", label: "Dutch" },
  { code: "pl-PL", label: "Polish" },
  { code: "sv-SE", label: "Swedish" },
  { code: "tr-TR", label: "Turkish" },
  { code: "uk-UA", label: "Ukrainian" },
  { code: "vi-VN", label: "Vietnamese" },
  { code: "th-TH", label: "Thai" },
];

const selectStyle: React.CSSProperties = {
  background: "var(--color-input-bg)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-primary)",
};

export function AudioSettingsModal({ open, onClose }: AudioSettingsModalProps) {
  const { settings, updateSettings, active } = useVoiceToText();

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedId, setSelectedId] = useState(getSavedDeviceId);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      setDevices(inputs);
      if (!inputs.find((d) => d.deviceId === selectedId) && inputs.length > 0) {
        setSelectedId(inputs[0].deviceId);
      }
      setError("");
    } catch (e) {
      setError(`Could not access microphones: ${(e as Error).message}`);
    }
  }, [selectedId]);

  useEffect(() => {
    if (open) loadDevices();
    if (!open) stopTest();
  }, [open, loadDevices]);

  const stopTest = useCallback(() => {
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = 0; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
    analyserRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const startTest = useCallback(async () => {
    stopTest();
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedId ? { deviceId: { exact: selectedId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      setTesting(true);
      setError("");

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = sum / dataArray.length;
        setLevel(Math.min(100, (avg / 128) * 100));
        animRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      setError(`Mic test failed: ${(e as Error).message}`);
    }
  }, [selectedId, stopTest]);

  const handleSelectDevice = (id: string) => {
    setSelectedId(id);
    saveDeviceId(id);
    if (testing) stopTest();
  };

  useEffect(() => {
    return () => stopTest();
  }, [stopTest]);

  if (!open) return null;

  const meterColor = level < 20 ? "var(--color-text-muted)" : level < 60 ? "#4A7C4A" : "#e05050";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(50,50,50,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-[480px] max-h-[85vh] overflow-y-auto animate-fade-in"
        style={{
          background: "var(--color-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: "var(--color-foreground)" }}>
            <Mic className="w-5 h-5" />
            Audio &amp; Voice Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md cursor-pointer"
            style={{ background: "transparent", border: "none", color: "var(--color-text-muted)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">

          {/* ── Input Device ──────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Input Device (Microphone)
            </h3>
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Select the mic you want to use for Voice to Text.
            </p>
            {error && (
              <p className="text-[11px] rounded px-2 py-1" style={{ color: "#e05050", background: "rgba(224,80,80,0.1)" }}>{error}</p>
            )}
            <div className="space-y-1">
              {devices.length === 0 && !error && (
                <p className="text-xs py-2" style={{ color: "var(--color-text-muted)" }}>No audio input devices found</p>
              )}
              {devices.map((d) => (
                <button
                  key={d.deviceId}
                  onClick={() => handleSelectDevice(d.deviceId)}
                  className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-left cursor-pointer"
                  style={{
                    background: selectedId === d.deviceId ? "var(--color-hover)" : "transparent",
                    border: selectedId === d.deviceId ? "1px solid var(--color-border-hover)" : "1px solid transparent",
                  }}
                >
                  <div
                    className="h-3 w-3 shrink-0 rounded-full border-2"
                    style={{
                      borderColor: selectedId === d.deviceId ? "var(--color-text-secondary)" : "var(--color-border)",
                      background: selectedId === d.deviceId ? "var(--color-text-secondary)" : "transparent",
                    }}
                  />
                  <span className="text-xs" style={{ color: "var(--color-text-primary)" }}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)}...)`}
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={loadDevices}
              className="text-[10px] px-2 py-0.5 rounded cursor-pointer"
              style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
            >Refresh Devices</button>
          </div>

          {/* ── Mic Test ──────────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Mic Test
            </h3>
            <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
              Speak into your mic to check it's working. The level bar should move when you talk.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={testing ? stopTest : startTest}
                className="px-3 py-1.5 text-xs rounded cursor-pointer font-medium shrink-0"
                style={{
                  background: testing ? "#8B3A3A" : "var(--color-accent)",
                  color: "var(--color-foreground)",
                  border: testing ? "1px solid #a04040" : "1px solid var(--color-border)",
                }}
              >{testing ? "Stop Test" : "Start Test"}</button>

              <div className="flex-1 h-5 rounded overflow-hidden relative" style={{ background: "var(--color-input-bg)", border: "1px solid var(--color-border)" }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${level}%`,
                    background: meterColor,
                    transition: "width 60ms linear, background 200ms ease",
                  }}
                />
                {testing && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium" style={{ color: "var(--color-foreground)" }}>
                    {Math.round(level)}%
                  </span>
                )}
                {!testing && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                    Not testing
                  </span>
                )}
              </div>
            </div>
            {testing && level < 3 && (
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                No sound detected — try speaking or check that the correct device is selected above.
              </p>
            )}
          </div>

          {/* ── Recognition Settings ──────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Voice Recognition Settings
            </h3>

            {active && (
              <p className="text-[10px] rounded px-2 py-1" style={{ color: "var(--color-warning)", background: "rgba(184,134,11,0.1)" }}>
                Voice recording is active. Changes will apply next time you start it.
              </p>
            )}

            {/* Language */}
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>Language</label>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                The language you'll be speaking in. Pick the closest match for best accuracy.
              </p>
              <select
                className="w-full px-2 py-1.5 text-xs rounded"
                style={selectStyle}
                value={settings.lang}
                onChange={(e) => updateSettings({ lang: e.target.value })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
                ))}
              </select>
            </div>

            {/* Continuous */}
            <div className="flex items-start gap-3">
              <button
                onClick={() => updateSettings({ continuous: !settings.continuous })}
                className="mt-0.5 w-8 h-[18px] rounded-full shrink-0 cursor-pointer relative"
                style={{
                  background: settings.continuous ? "#4A7C4A" : "var(--color-input-bg)",
                  border: "1px solid var(--color-border)",
                  transition: "background 150ms ease",
                }}
              >
                <span
                  className="absolute top-[2px] w-3 h-3 rounded-full"
                  style={{
                    background: "var(--color-foreground)",
                    left: settings.continuous ? 14 : 2,
                    transition: "left 150ms ease",
                  }}
                />
              </button>
              <div>
                <span className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>Continuous Listening</span>
                <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  {settings.continuous
                    ? "Keeps listening until you stop it — great for long dictation."
                    : "Stops after you pause speaking — good for short phrases."}
                </p>
              </div>
            </div>

            {/* Send Interval */}
            <div className="space-y-1">
              <label className="text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>Transcription Speed</label>
              <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                How often audio is sent to Gemini for transcription. Longer intervals give better accuracy because Gemini gets more context per chunk. Shorter intervals feel more responsive but may misinterpret words.
              </p>
              <div className="flex gap-1">
                {[
                  { val: 4000, label: "4s (Fast)" },
                  { val: 7000, label: "7s (Balanced)" },
                  { val: 10000, label: "10s (Accurate)" },
                  { val: 15000, label: "15s (Best)" },
                ].map(({ val, label }) => (
                  <button
                    key={val}
                    onClick={() => updateSettings({ sendInterval: val })}
                    className="px-2 py-1 text-[11px] rounded cursor-pointer"
                    style={{
                      background: settings.sendInterval === val ? "var(--color-accent)" : "var(--color-input-bg)",
                      color: settings.sendInterval === val ? "var(--color-foreground)" : "var(--color-text-muted)",
                      border: `1px solid ${settings.sendInterval === val ? "var(--color-accent)" : "var(--color-border)"}`,
                    }}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Info ──────────────────────────────────────────── */}
          <div className="rounded px-3 py-2" style={{ background: "rgba(90,90,90,0.3)", border: "1px solid var(--color-border)" }}>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              Voice to Text is powered by <strong>Google Gemini</strong> — the same API you already use for image generation. Audio is recorded locally, sent to Gemini for transcription, and the text is inserted into whatever field has focus. Uses your existing API key.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
