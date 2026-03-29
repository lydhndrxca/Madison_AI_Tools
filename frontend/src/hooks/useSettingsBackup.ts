/**
 * Auto-backup & restore for all madison_* / madison-* localStorage keys.
 *
 * On mount:
 *  1. Fetch the backup from disk via GET /system/settings-backup.
 *  2. If localStorage has zero madison keys but backup exists → auto-restore.
 *  3. If localStorage has keys → save a fresh backup to disk.
 *
 * On changes:
 *  - Debounced auto-backup every 10 seconds after any localStorage mutation.
 *
 * The backend writes to two locations for redundancy:
 *   config/user_settings_backup.json   (project-local)
 *   ~/.madison_ai/settings_backup.json (survives directory moves)
 */

import { useEffect, useRef } from "react";
import { apiFetch } from "./useApi";

const MADISON_PREFIX_RE = /^madison[-_]/;
const DEBOUNCE_MS = 10_000;

function getMadisonKeys(): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && MADISON_PREFIX_RE.test(key)) {
      const val = localStorage.getItem(key);
      if (val !== null) result[key] = val;
    }
  }
  return result;
}

function hasMadisonKeys(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && MADISON_PREFIX_RE.test(key)) return true;
  }
  return false;
}

function restoreFromBackup(data: Record<string, string>) {
  for (const [key, val] of Object.entries(data)) {
    if (typeof val === "string") {
      localStorage.setItem(key, val);
    }
  }
}

async function pushBackupToDisk() {
  const data = getMadisonKeys();
  if (Object.keys(data).length === 0) return;
  try {
    await apiFetch("/system/settings-backup", {
      method: "POST",
      body: JSON.stringify({ data }),
    });
  } catch { /* backend may be down during shutdown */ }
}

export function useSettingsBackup() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      try {
        const resp = await apiFetch<{ ok: boolean; data: Record<string, string> }>(
          "/system/settings-backup",
        );

        if (!hasMadisonKeys() && resp.ok && resp.data && Object.keys(resp.data).length > 0) {
          restoreFromBackup(resp.data);
          window.location.reload();
          return;
        }

        await pushBackupToDisk();
      } catch { /* first launch or backend not ready */ }
    })();
  }, []);

  useEffect(() => {
    const scheduleBackup = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { pushBackupToDisk(); }, DEBOUNCE_MS);
    };

    const origSetItem = localStorage.setItem.bind(localStorage);
    const origRemoveItem = localStorage.removeItem.bind(localStorage);

    localStorage.setItem = function (key: string, value: string) {
      origSetItem(key, value);
      if (MADISON_PREFIX_RE.test(key)) scheduleBackup();
    };

    localStorage.removeItem = function (key: string) {
      origRemoveItem(key);
      if (MADISON_PREFIX_RE.test(key)) scheduleBackup();
    };

    window.addEventListener("beforeunload", () => { pushBackupToDisk(); });

    return () => {
      localStorage.setItem = origSetItem;
      localStorage.removeItem = origRemoveItem;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
