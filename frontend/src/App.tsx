import { useCallback, useEffect, useState } from "react";
import { CircularMap } from "./components/CircularMap";
import { EditPanel } from "./components/EditPanel";
import { LinearMap } from "./components/LinearMap";
import { RecordLibrary } from "./components/RecordLibrary";
import { SequenceViewer } from "./components/SequenceViewer";
import { Toolbar } from "./components/Toolbar";
import { api } from "./lib/api";
import type { CutSite, Feature, PlasmidRecord, Selection } from "./lib/types";

const DEMO_SEQ =
  "TAATACGACTCACTATAGGGAATTGTGAGCGGATAACAATTCCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACAT" +
  "ATGGGCCACCACCACCACCACCACGGCAGCGGCGAAAACCTGTATTTTCAGGGCAGCATGGTGAGCAAGGGCGAGGAGCTGTTCACC" +
  "GGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACC" +
  "TACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGC" +
  "GTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGC" +
  "ACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTG" +
  "AAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCC" +
  "GACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAG" +
  "CAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAAC" +
  "GAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA" +
  "CTGCAGGCTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG";

export default function App() {
  const [record, setRecord] = useState<PlasmidRecord | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [cutSites, setCutSites] = useState<CutSite[]>([]);
  const [enzymeInput, setEnzymeInput] = useState("EcoRI, HindIII, BamHI, XhoI, NdeI");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("connecting…");

  useEffect(() => {
    api
      .health()
      .then((h) => setStatus(`backend ${h.version}`))
      .catch(() => setStatus("backend offline"));
  }, []);

  const selectFeature = useCallback((f: Feature) => {
    setSelection({ start: f.start, end: f.end, featureId: f.id });
  }, []);

  const selectFeatureById = useCallback(
    (id: string) => {
      const f = record?.features.find((x) => x.id === id);
      if (f) selectFeature(f);
    },
    [record, selectFeature],
  );

  const reloadCutSites = useCallback(
    async (enzymes: string[]) => {
      if (!record) return;
      try {
        setCutSites(await api.cutSites(record.id, enzymes));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [record],
  );

  // Recompute cut sites whenever the sequence changes.
  useEffect(() => {
    if (!record) {
      setCutSites([]);
      return;
    }
    const enzymes = enzymeInput
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    api.cutSites(record.id, enzymes).then(setCutSites).catch(() => setCutSites([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id, record?.sequence, enzymeInput]);

  const loadDemo = async () => {
    try {
      const r = await api.createRecord("pET-demo (T7/His/GFP)", DEMO_SEQ, true);
      const res = await api.annotate(r.id);
      setRecord(res.record);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="app">
      <Toolbar
        record={record}
        onRecordChange={setRecord}
        onError={setError}
        onShowLibrary={() => {
          setRecord(null);
          setSelection(null);
        }}
      />
      {error && (
        <div className="error-bar" onClick={() => setError(null)}>
          {error} <span className="muted">(click to dismiss)</span>
        </div>
      )}

      {!record ? (
        <RecordLibrary
          onOpen={(r) => {
            setSelection(null);
            setRecord(r);
          }}
          onDemo={loadDemo}
          onError={setError}
          status={status}
        />
      ) : (
        <div className="workspace">
          <div className="maps">
            <div className="card">
              <CircularMap
                record={record}
                cutSites={cutSites}
                selection={selection}
                onSelectFeature={selectFeature}
                onHover={setHoveredId}
                hoveredId={hoveredId}
              />
            </div>
            <div className="card">
              <h3 className="card-title">Linear map</h3>
              <LinearMap
                record={record}
                cutSites={cutSites}
                selection={selection}
                onSelectFeature={selectFeature}
                onHover={setHoveredId}
                hoveredId={hoveredId}
              />
            </div>
            <div className="card">
              <h3 className="card-title">Sequence</h3>
              <SequenceViewer
                record={record}
                selection={selection}
                onSelect={setSelection}
                hoveredId={hoveredId}
              />
            </div>
          </div>

          <div className="side">
            <EditPanel
              record={record}
              selection={selection}
              cutSites={cutSites}
              onRecordChange={setRecord}
              onSelectFeature={selectFeatureById}
              onError={setError}
              onReloadCutSites={reloadCutSites}
              enzymeInput={enzymeInput}
              setEnzymeInput={setEnzymeInput}
            />
          </div>
        </div>
      )}
    </div>
  );
}
