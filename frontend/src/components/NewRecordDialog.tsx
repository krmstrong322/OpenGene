import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { api } from "../lib/api";
import type { PlasmidRecord } from "../lib/types";

interface Props {
  onClose: () => void;
  onCreated: (r: PlasmidRecord) => void;
  onError: (msg: string) => void;
}

// Modal for creating a record from a pasted sequence.
export function NewRecordDialog({ onClose, onCreated, onError }: Props) {
  const [name, setName] = useState("new_construct");
  const [seq, setSeq] = useState("");
  const [circular, setCircular] = useState(true);
  const [busy, setBusy] = useState(false);
  const seqRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    seqRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bases = seq.replace(/[^A-Za-z]/g, "").length;

  const create = async () => {
    setBusy(true);
    try {
      onCreated(await api.createRecord(name, seq, circular));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-title">
        <div className="dialog-head">
          <h2 id="new-title">New sequence</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <div className="dialog-body">
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span style={{ display: "flex" }}>
              Sequence
              <span className="spacer" />
              {bases > 0 && <span className="num">{bases.toLocaleString()} bp</span>}
            </span>
            <textarea
              ref={seqRef}
              className="textarea mono"
              value={seq}
              onChange={(e) => setSeq(e.target.value)}
              placeholder="ACGTN…"
              rows={6}
              spellCheck={false}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={circular}
              onChange={(e) => setCircular(e.target.checked)}
            />
            Circular
          </label>
        </div>
        <div className="dialog-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!seq.trim() || busy} onClick={create}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
