// Saving a record as a file. The engine writes the file; the UI fetches it
// (so the request carries the desktop app's access token, which a plain link
// could not) and hands it to the browser's download.
import { api } from "./api";

// [engine format, menu label, file extension]
export const EXPORT_FORMATS: [string, string, string][] = [
  ["snapgene", "SnapGene", "dna"],
  ["genbank", "GenBank", "gb"],
  ["fasta", "FASTA", "fasta"],
  ["embl", "EMBL", "embl"],
];

export async function exportRecord(record: { id: string; name: string }, format: string): Promise<void> {
  const ext = EXPORT_FORMATS.find(([f]) => f === format)?.[2] ?? format;
  saveBlob(await api.exportFile(record.id, format), `${record.name}.${ext}`);
}

/** Hand a file the engine produced to the browser's download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the download a moment to start before the URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
