// The inspector: a tabbed panel docked beside the workspace. Each tab lives in
// ./inspector; this file is the tab strip and the hand-off of commands to tabs.
import { useEffect, useState } from "react";
import { EditTab } from "./inspector/EditTab";
import { EnzymesTab } from "./inspector/EnzymesTab";
import { FeaturesTab } from "./inspector/FeaturesTab";
import { HistoryTab } from "./inspector/HistoryTab";
import { OrfsTab } from "./inspector/OrfsTab";
import { PrimersTab } from "./inspector/PrimersTab";
import type { Props } from "./inspector/shared";

export type { InspectorCommand } from "./inspector/shared";

type Tab = "edit" | "features" | "orfs" | "enzymes" | "primers" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "edit", label: "Edit" },
  { id: "features", label: "Features" },
  { id: "orfs", label: "ORFs" },
  { id: "enzymes", label: "Enzymes" },
  { id: "primers", label: "Primers" },
  { id: "history", label: "History" },
];

export function EditPanel(props: Props) {
  const { record, selection, onRecordChange, onError } = props;
  const [tab, setTab] = useState<Tab>("edit");
  // A command opens the tab that handles it; that tab then carries it out.
  useEffect(() => {
    if (props.command) setTab(props.command.kind === "design-primers" ? "primers" : "features");
  }, [props.command]);

  return (
    <aside className="panel">
      {/* One tab stop; the arrow keys move between tabs. */}
      <div
        className="tabs"
        role="tablist"
        aria-label="Inspector"
        onKeyDown={(e) => {
          const i = TABS.findIndex((t) => t.id === tab);
          const next =
            e.key === "ArrowRight"
              ? (i + 1) % TABS.length
              : e.key === "ArrowLeft"
                ? (i - 1 + TABS.length) % TABS.length
                : e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? TABS.length - 1
                    : -1;
          if (next < 0) return;
          e.preventDefault();
          setTab(TABS[next].id);
          document.getElementById(`tab-${TABS[next].id}`)?.focus();
        }}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            id={`tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls="inspector-panel"
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body" id="inspector-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === "history" && (
          <HistoryTab record={record} onUndo={props.onUndo} onRedo={props.onRedo} />
        )}
        {tab === "edit" && <EditTab {...props} />}
        {tab === "features" && <FeaturesTab {...props} />}
        {tab === "orfs" && <OrfsTab record={record} onError={onError} />}
        {tab === "enzymes" && <EnzymesTab {...props} />}
        {tab === "primers" && (
          <PrimersTab
            record={record}
            selection={selection}
            onError={onError}
            onRecordChange={onRecordChange}
            command={props.command}
            onCommandDone={props.onCommandDone}
          />
        )}
      </div>
    </aside>
  );
}
