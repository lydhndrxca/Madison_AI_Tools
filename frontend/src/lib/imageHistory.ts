export interface HistorySettings {
  description: string;
  age: string;
  race: string;
  gender: string;
  build: string;
  editPrompt: string;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  label: string;
  image_b64: string;
  settings: HistorySettings;
}

export interface ImageRecord {
  id: string;
  tab: string;
  galleryIndex: number;
  currentImage: string;
  history: HistoryEntry[];
}

let _counter = 0;
function uid(): string {
  return `${Date.now()}-${++_counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createHistoryEntry(
  label: string,
  image_b64: string,
  settings: HistorySettings,
): HistoryEntry {
  return {
    id: uid(),
    timestamp: new Date().toLocaleTimeString(),
    label,
    image_b64,
    settings,
  };
}

export function createImageRecord(tab: string, galleryIndex: number, image: string): ImageRecord {
  return {
    id: uid(),
    tab,
    galleryIndex,
    currentImage: image,
    history: [],
  };
}

export function pushHistory(record: ImageRecord, entry: HistoryEntry): ImageRecord {
  return {
    ...record,
    history: [entry, ...record.history],
  };
}

export function restoreFromHistory(record: ImageRecord, entryId: string): { record: ImageRecord; entry: HistoryEntry } | null {
  const entry = record.history.find((h) => h.id === entryId);
  if (!entry) return null;
  return {
    record: { ...record, currentImage: entry.image_b64 },
    entry,
  };
}

export function clearHistory(record: ImageRecord): ImageRecord {
  return { ...record, history: [] };
}

export function serializeHistory(records: ImageRecord[]): string {
  return JSON.stringify(records.map((r) => ({
    ...r,
    history: r.history.map((h) => ({
      id: h.id,
      timestamp: h.timestamp,
      label: h.label,
      settings: h.settings,
    })),
  })));
}
