import { useState } from "react";
import { ChevronDown, ImageDown } from "lucide-react";
import { exportMap, printMap, type ImageFormat } from "../lib/mapExport";
import { Menu } from "./Menu";

interface Props {
  getSvg: () => SVGSVGElement | null;
  fileBase: string; // file name without extension
  title: string; // printed heading
  subtitle: string;
  onError: (msg: string) => void;
}

const FORMATS: [ImageFormat, string, string][] = [
  ["svg", "SVG", "vector, editable"],
  ["png", "PNG", "3× resolution"],
  ["pdf", "PDF", "vector"],
];

/** Save a map as SVG / PNG / PDF, or print it. */
export function ImageMenu({ getSvg, fileBase, title, subtitle, onError }: Props) {
  const [busy, setBusy] = useState(false);

  const run = async (fn: (svg: SVGSVGElement) => Promise<void>) => {
    const svg = getSvg();
    if (!svg) return;
    setBusy(true);
    try {
      await fn(svg);
    } catch (e) {
      onError(`Couldn't export the map: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu
      label={
        <>
          <ImageDown size={14} />
          <span className="bar-text">{busy ? "Exporting…" : "Image"}</span>
          <ChevronDown size={12} />
        </>
      }
      buttonClass="btn btn-ghost btn-sm"
      title="Save or print this map"
    >
      {FORMATS.map(([fmt, label, sub]) => (
        <button key={fmt} className="menu-item" onClick={() => void run((svg) => exportMap(svg, fmt, fileBase))}>
          {label} <span className="menu-sub">{sub}</span>
        </button>
      ))}
      <button className="menu-item" onClick={() => void run((svg) => printMap(svg, title, subtitle))}>
        Print…
      </button>
    </Menu>
  );
}
