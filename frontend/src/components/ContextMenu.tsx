import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuEntry =
  | { kind?: "item"; label: string; hint?: string; danger?: boolean; disabled?: boolean; run: () => void }
  | { kind: "sep" }
  | { kind: "heading"; label: string };

// A menu opened at the pointer (right-click). It keeps itself on screen, takes
// focus so the arrow keys work, and closes on Escape, an outside click, a
// scroll or when the window loses focus.
export function ContextMenu({
  x,
  y,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    document.addEventListener("mousedown", down, true);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      ref={ref}
      className="menu context-menu"
      role="menu"
      style={pos}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry.kind === "sep") return <div key={i} className="menu-sep" role="separator" />;
        if (entry.kind === "heading") {
          return (
            <div key={i} className="menu-label" title={entry.label}>
              {entry.label}
            </div>
          );
        }
        return (
          <button
            key={i}
            role="menuitem"
            className={entry.danger ? "menu-item danger" : "menu-item"}
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.run();
            }}
          >
            {entry.label}
            {entry.hint && <span className="menu-sub">{entry.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
