// The Electron shell, when the UI runs inside the desktop app (see
// desktop/electron/preload.js). In a browser `window.opengeneDesktop` is
// undefined and none of this applies.
export interface DesktopBridge {
  /** A menu item was chosen: "new", "undo", "export:genbank", "view:map", … */
  onCommand: (callback: (command: string) => void) => () => void;
  /** Files handed to the app (Open…, double-click, "Open With", command line). */
  onOpenFiles: (callback: (files: { name: string; data: Uint8Array }[]) => void) => () => void;
  /** Call once subscribed; files queued before the UI was up arrive after it. */
  ready: () => void;
  setMenuState: (state: { hasRecord: boolean }) => void;
  /** Text-field undo / redo / select-all, for when a text field has the focus. */
  textRole: (role: "undo" | "redo" | "selectAll") => void;
}

declare global {
  interface Window {
    opengeneDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | undefined =
  typeof window !== "undefined" ? window.opengeneDesktop : undefined;

/** True while the keyboard focus is in a text field (which owns undo, select-all…). */
export function textFieldFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "color", "file", "range"].includes(type);
}
