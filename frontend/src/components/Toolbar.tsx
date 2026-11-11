import {
  AlignLeft,
  Check,
  ChevronDown,
  Circle,
  Download,
  Minus,
  Monitor,
  Moon,
  Plus,
  Redo2,
  Sun,
  Undo2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { Menu } from "./Menu";
import type { ViewId } from "../lib/layout";
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
  onRename: (name: string) => void;
  onSetCircular: (circular: boolean) => void;
  onDuplicate: () => void;
  views: Record<ViewId, boolean>;
  onToggleView: (id: ViewId) => void;
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

const VIEWS: { id: ViewId; label: string; Icon: typeof Circle }[] = [
  { id: "map", label: "Map", Icon: Circle },
  { id: "linear", label: "Linear", Icon: Minus },
  { id: "sequence", label: "Sequence", Icon: AlignLeft },
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
  onRename,
  onSetCircular,
  onDuplicate,
  views,
  onToggleView,
  theme,
  onThemeChange,
}: Props) {
  // Renaming happens in place, in the breadcrumb.
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const startRename = () => {
    if (!record) return;
    setDraft(record.name);
    setRenaming(true);
  };
  const commitRename = () => {
    setRenaming(false);
    const name = draft.trim();
    if (record && name && name !== record.name) onRename(name);
  };
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
          {renaming ? (
            <input
              className="input crumb-input"
              value={draft}
              autoFocus
              aria-label="Record name"
              maxLength={200}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <button
              className="crumb-name"
              title={`${record.name} — click to rename`}
              onClick={startRename}
            >
              {record.name}
            </button>
          )}
          <span className="crumb-meta">
            {record.length.toLocaleString()} bp · {record.isCircular ? "circular" : "linear"}
          </span>
          <Menu
            label={<ChevronDown size={13} />}
            buttonClass="icon-btn sm"
            title="Record actions"
            align="left"
          >
            <button className="menu-item" onClick={startRename}>
              Rename…
            </button>
            <button
              className="menu-item"
              disabled={record.hasTrace}
              title={record.hasTrace ? "A sequencing read is always linear" : undefined}
              onClick={() => onSetCircular(!record.isCircular)}
            >
              {record.isCircular ? "Make linear" : "Make circular"}
            </button>
            <button className="menu-item" onClick={onDuplicate}>
              Duplicate
            </button>
          </Menu>
        </nav>
      )}

      <span className="spacer" />

      <div className="bar-actions">
        {record && (
          <>
            <div className="view-toggles" role="group" aria-label="Views">
              {VIEWS.map(({ id, label, Icon }) => {
                const last = views[id] && Object.values(views).filter(Boolean).length === 1;
                return (
                  <button
                    key={id}
                    className={views[id] ? "view-toggle on" : "view-toggle"}
                    aria-pressed={views[id]}
                    disabled={last}
                    onClick={() => onToggleView(id)}
                    title={
                      last
                        ? `${label} is the only view open`
                        : `${views[id] ? "Hide" : "Show"} the ${label.toLowerCase()} view`
                    }
                  >
                    <Icon size={13} />
                    <span className="bar-text">{label}</span>
                  </button>
                );
              })}
            </div>
            <span className="bar-sep" />
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
