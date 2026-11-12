import { sentence } from "./shared";
import type { PlasmidRecord } from "../../lib/types";

// Every change that can be undone, newest first.
export function HistoryTab({
  record,
  onUndo,
  onRedo,
}: {
  record: PlasmidRecord;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const steps = [...record.history].reverse();
  return (
    <div className="stack">
      <section className="section">
        <h4 className="section-title">
          Changes <span className="count">{steps.length}</span>
        </h4>
        <div className="row">
          <button className="btn" onClick={onUndo} disabled={!record.canUndo}>
            Undo
          </button>
          <button className="btn" onClick={onRedo} disabled={!record.canRedo}>
            Redo
          </button>
        </div>
        {steps.length === 0 ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Nothing has been changed yet. Edits to this record are listed here, newest first,
            and can be undone one at a time.
          </p>
        ) : (
          !record.canUndo &&
          !record.canRedo && (
            <p className="hint" style={{ marginBottom: 0 }}>
              These changes were made before OpenGene was last started and can no longer be undone.
            </p>
          )
        )}
        {steps.length > 0 && (
          <ol className="list history" reversed>
            {steps.map((h, i) => (
              <li key={h.id} className={i === 0 ? "latest" : undefined}>
                <div className="list-row">
                  <span className="grow history-text">{sentence(h.description)}</span>
                  <time
                    className="list-sub"
                    dateTime={new Date(h.timestamp * 1000).toISOString()}
                    title={new Date(h.timestamp * 1000).toLocaleString()}
                  >
                    {new Date(h.timestamp * 1000).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                {h.warnings.map((w, wi) => (
                  <span key={wi} className="list-sub history-warning">
                    {sentence(w)}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
