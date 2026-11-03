import { useRef, useState } from "react";
import { api } from "../lib/api";
import type { PlasmidRecord } from "../lib/types";

interface Props {
  record: PlasmidRecord | null;
  onRecordChange: (r: PlasmidRecord) => void;
  onError: (msg: string) => void;
}

export function Toolbar({ record, onRecordChange, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("new_construct");
  const [seq, setSeq] = useState("");
  const [circular, setCircular] = useState(true);

  const handleImport = async (file: File) => {
    try {
      onRecordChange(await api.importFile(file));
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const create = async () => {
    try {
      onRecordChange(await api.createRecord(name, seq, circular));
      setShowNew(false);
      setSeq("");
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="toolbar">
      <strong className="brand">🧬 OpenGene</strong>
      <button onClick={() => setShowNew((v) => !v)}>New</button>
      <button onClick={() => fileRef.current?.click()}>Import…</button>
      <input
        ref={fileRef}
        type="file"
        accept=".gb,.gbk,.genbank,.fasta,.fa,.fna,.embl,.dna"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImport(f);
          e.target.value = "";
        }}
      />
      {record && (
        <>
          <a className="btnlink" href={api.exportUrl(record.id, "genbank")} download={`${record.name}.gb`}>
            Export GenBank
          </a>
          <a className="btnlink" href={api.exportUrl(record.id, "fasta")} download={`${record.name}.fasta`}>
            FASTA
          </a>
          <span className="spacer" />
          <span className="muted">
            {record.name} · {record.length.toLocaleString()} bp · {record.isCircular ? "circular" : "linear"}
          </span>
        </>
      )}

      {showNew && (
        <div className="new-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
          <textarea
            value={seq}
            onChange={(e) => setSeq(e.target.value)}
            placeholder="Paste sequence (ACGTN)…"
            rows={3}
          />
          <label className="inline">
            <input type="checkbox" checked={circular} onChange={(e) => setCircular(e.target.checked)} />
            circular
          </label>
          <button disabled={!seq} onClick={create}>
            Create
          </button>
        </div>
      )}
    </div>
  );
}
