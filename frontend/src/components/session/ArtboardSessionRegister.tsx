import { useArtboard, type ArtboardSessionSnapshot } from "@/hooks/ArtboardContext";
import { useSessionRegister } from "@/hooks/SessionContext";

/** Bridges global Art Table into session templates (local + shared room). */
export function ArtboardSessionRegister() {
  const { snapshotForSession, applySessionState } = useArtboard();
  useSessionRegister(
    "artboard",
    () => snapshotForSession(),
    (s: unknown) => {
      if (s === null) {
        applySessionState(null);
        return;
      }
      applySessionState(s as ArtboardSessionSnapshot);
    },
  );
  return null;
}
