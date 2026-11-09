import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Monitor,
  Moon,
  Plus,
  Redo2,
  Sun,
  Undo2,
  Upload,
} from "lucide-react";
import { api } from "../lib/api";
import type { ThemePref } from "../lib/theme";
import type { PlasmidRecord } from "../lib/types";
import logoUrl from "../assets/logo.svg";

interface Props {
  record: PlasmidRecord | null;
  onShowLibrary: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onImport: () => void;
  theme: ThemePref;
  onThemeChange: (t: ThemePref) => void;
}

// [API format, menu label, file extension]
const EXPORT_FORMATS: [string, string, string][] = [
  ["snapgene", "SnapGene", "dna"],
  ["genbank", "GenBank", "gb"],
  ["fasta", "FASTA", "fasta"],
  ["embl", "EMBL", "embl"],
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

export function Toolbar({
  record,
  onShowLibrary,
  onUndo,
  onRedo,
  onNew,
  onImport,
  theme,
  onThemeChange,
}: Props) {
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <header className="titlebar">
      <button className="brand" onClick={onShowLibrary} title="Library">
        <img src={logoUrl} alt="" width={18} height={18} />
        <span className="brand-text">OpenGene</span>
      </button>

      {record && (
        <nav className="crumbs" aria-label="Breadcrumb">
          <span className="sep">/</span>
          <button className="crumb-link" onClick={onShowLibrary}>
            Library
          </button>
          <span className="sep">/</span>
          <span className="crumb-name" title={record.name}>
            {record.name}
          </span>
          <span className="crumb-meta">
            {record.length.toLocaleString()} bp · {record.isCircular ? "circular" : "linear"}
          </span>
        </nav>
      )}

      <span className="spacer" />

      <div className="bar-actions">
        {record && (
          <>
            <button
              className="icon-btn"
              onClick={onUndo}
              disabled={!record.canUndo}
              title={`Undo (${MOD}Z)`}
              aria-label="Undo"
            >
              <Undo2 size={15} />
            </button>
            <button
              className="icon-btn"
              onClick={onRedo}
              disabled={!record.canRedo}
              title={`Redo (${MOD}${isMac ? "⇧Z" : "Shift+Z"})`}
              aria-label="Redo"
            >
              <Redo2 size={15} />
            </button>
            <span className="bar-sep" />
          </>
        )}

        {record && (
          <>
            <button className="btn btn-ghost" onClick={onNew} title="New sequence">
              <Plus size={14} />
              <span className="bar-text">New</span>
            </button>
            <button className="btn btn-ghost" onClick={onImport} title="Import a file">
              <Upload size={14} />
              <span className="bar-text">Import</span>
            </button>
          </>
        )}

        {record && (
          <Menu
            label={
              <>
                <Download size={14} />
                <span className="bar-text">Export</span>
                <ChevronDown size={12} />
              </>
            }
            buttonClass="btn btn-ghost"
            title="Export"
          >
            {EXPORT_FORMATS.map(([fmt, label, ext]) => (
              <a
                key={fmt}
                className="menu-item"
                href={api.exportUrl(record.id, fmt)}
                download={`${record.name}.${ext}`}
              >
                {label} <span className="menu-sub">.{ext}</span>
              </a>
            ))}
          </Menu>
        )}

        {record && <span className="bar-sep" />}
        <Menu label={<ThemeIcon size={15} />} buttonClass="icon-btn" title="Appearance">
          <div className="menu-label">Appearance</div>
          {(
            [
              ["system", "Match system"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as const
          ).map(([value, text]) => (
            <button key={value} className="menu-item" onClick={() => onThemeChange(value)}>
              {text}
              {theme === value && <Check size={13} className="check-mark" />}
            </button>
          ))}
        </Menu>
      </div>
    </header>
  );
}

// A button with a dropdown that closes on outside click, Escape, or choosing
// an item.
function Menu({
  label,
  buttonClass,
  title,
  children,
}: {
  label: ReactNode;
  buttonClass: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={buttonClass}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}
