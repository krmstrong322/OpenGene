import { useEffect, useState } from "react";

// Light / dark / follow-the-OS. The choice is a per-machine convenience, so it
// lives in localStorage; every access is guarded because storage can be
// unavailable (private windows, locked-down Electron profiles).
export type ThemePref = "system" | "light" | "dark";

const KEY = "opengene.theme";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function useTheme(): [ThemePref, (t: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* storage unavailable */
    }
  }, [pref]);

  return [pref, setPref];
}
