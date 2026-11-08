import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
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
    <header className="app-header">
      <button className="brand" onClick={onShowLibrary} title="All plasmids">
        <img src={logoUrl} alt="" width={26} height={26} />
        <span className="brand-text">OpenGene</span>
      </button>

      {record && (
        <>
          <span className="header-sep" />
          <div className="crumb">
            <button className="icon-btn sm" onClick={onShowLibrary} title="Back to plasmids">
              <ChevronLeft size={16} />
            </button>
            <span className="crumb-name" title={record.name}>
              {record.name}
            </span>
            <span className="crumb-meta inline">
              <span className="badge mono">{record.length.toLocaleString()} bp</span>
              <span className="badge">{record.isCircular ? "circular" : "linear"}</span>
            </span>
          </div>
        </>
      )}

      <span className="spacer" />

      <div className="header-actions">
        {record && (
          <div className="btn-group" role="group" aria-label="History">
            <button
              className="icon-btn"
              onClick={onUndo}
              disabled={!record.canUndo}
              title={`Undo (${MOD}Z)`}
              aria-label="Undo"
            >
              <Undo2 size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={onRedo}
              disabled={!record.canRedo}
              title={`Redo (${MOD}${isMac ? "⇧Z" : "Shift+Z"})`}
              aria-label="Redo"
            >
              <Redo2 size={16} />
            </button>
          </div>
        )}

        <button className="btn btn-ghost" onClick={onNew} title="New sequence">
          <Plus size={16} />
          <span className="btn-text">New</span>
        </button>
        <button className="btn btn-ghost" onClick={onImport} title="Import a file">
          <Upload size={15} />
          <span className="btn-text">Import</span>
        </button>

        {record && (
          <Menu
            label={
              <>
                <Download size={15} />
                <span className="btn-text">Export</span>
                <ChevronDown size={14} />
              </>
            }
            buttonClass="btn btn-primary"
            title="Export"
          >
            <div className="menu-label">Download as</div>
            <a
              className="menu-item"
              href={api.exportUrl(record.id, "genbank")}
              download={`${record.name}.gb`}
            >
              GenBank <span className="menu-sub">.gb</span>
            </a>
            <a
              className="menu-item"
              href={api.exportUrl(record.id, "fasta")}
              download={`${record.name}.fasta`}
            >
              FASTA <span className="menu-sub">.fasta</span>
            </a>
          </Menu>
        )}

        <Menu
          label={<ThemeIcon size={16} />}
          buttonClass="icon-btn"
          title="Appearance"
        >
          <div className="menu-label">Appearance</div>
          {(
            [
              ["system", "System", Monitor],
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const
          ).map(([value, text, Icon]) => (
            <button
              key={value}
              className={theme === value ? "menu-item checked" : "menu-item"}
              onClick={() => onThemeChange(value)}
            >
              <Icon size={15} />
              {text}
              {theme === value && <Check size={14} style={{ marginLeft: "auto" }} />}
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
