// Export a map (an on-screen <svg class="map-svg">) as a standalone SVG, a
// PNG, or a vector PDF, or print it.
//
// The maps are styled by the app stylesheet (classes + theme variables), so a
// copy of the SVG is first rendered off-screen with the *light* theme's
// variables and every computed paint/font property is written onto it as
// attributes. The result looks the same as the light map whatever theme the
// app is in, and needs no stylesheet. The selection highlight and the
// hover/selected emphasis are left out.

export type ImageFormat = "svg" | "png" | "pdf";

const PNG_SCALE = 3; // 3x: ~2500 px wide for the circular map
const SANS_STACK = '"IBM Plex Sans Variable", "IBM Plex Sans", Helvetica, Arial, sans-serif';

const SHAPE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linejoin",
  "stroke-linecap",
  "stroke-dasharray",
  "opacity",
] as const;
const TEXT_PROPS = ["font-size", "font-weight", "text-anchor", "dominant-baseline"] as const;
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan"]);

// The light theme's custom properties: the plain `:root` rule(s).
function lightThemeVars(): [string, string][] {
  const out: [string, string][] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
        for (const prop of Array.from(rule.style)) {
          if (prop.startsWith("--")) out.push([prop, rule.style.getPropertyValue(prop)]);
        }
      }
    }
  }
  return out;
}

// The app's sans font (Latin subsets) as data: @font-face rules, so text in
// an exported SVG/PNG keeps its look outside the app.
let fontCss: Promise<string> | null = null;
function embeddedFontCss(): Promise<string> {
  fontCss ??= (async () => {
    const faces: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        if (family !== "IBM Plex Sans Variable") continue;
        const src = rule.style.getPropertyValue("src");
        const m = src.match(/url\(["']?([^"')]+)["']?\)/);
        if (!m || !/latin/.test(m[1])) continue;
        try {
          const url = new URL(m[1], sheet.href ?? document.baseURI).href;
          const buf = await (await fetch(url)).arrayBuffer();
          let bin = "";
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          }
          const range = rule.style.getPropertyValue("unicode-range");
          faces.push(
            `@font-face{font-family:"IBM Plex Sans Variable";font-weight:100 900;` +
              `src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");` +
              (range ? `unicode-range:${range};` : "") +
              "}",
          );
        } catch {
          // Without the font the SVG falls back to Helvetica/Arial.
        }
      }
    }
    return faces.join("");
  })();
  return fontCss;
}

/** A self-contained copy of `svg` with its styles written in as attributes. */
function inlineStyles(svg: SVGSVGElement, pdf: boolean): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".sel").forEach((el) => el.remove());
  clone.querySelectorAll(".active").forEach((el) => el.classList.remove("active"));

  // Render off-screen under the light theme so computed styles resolve to it.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden";
  for (const [k, v] of lightThemeVars()) host.style.setProperty(k, v);
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    const all = [clone, ...Array.from(clone.querySelectorAll<SVGElement>("*"))];
    for (const el of all) {
      const tag = el.tagName.toLowerCase();
      if (!SHAPES.has(tag)) continue;
      const cs = getComputedStyle(el);
      for (const p of SHAPE_PROPS) el.setAttribute(p, cs.getPropertyValue(p));
      if (tag === "text" || tag === "tspan") {
        for (const p of TEXT_PROPS) el.setAttribute(p, cs.getPropertyValue(p));
        if (pdf) {
          // The PDF uses the built-in Helvetica, which has only normal and
          // bold; any other weight would fall back to Times.
          el.setAttribute("font-family", "helvetica");
          el.setAttribute("font-weight", Number(cs.fontWeight) >= 600 ? "bold" : "normal");
          // svg2pdf ignores dominant-baseline: centre "middle" text by moving
          // its baseline down a third of an em instead.
          const baseline = cs.getPropertyValue("dominant-baseline");
          if ((baseline === "middle" || baseline === "central") && el.hasAttribute("y")) {
            const y = Number(el.getAttribute("y"));
            if (Number.isFinite(y)) el.setAttribute("y", String(y + parseFloat(cs.fontSize) * 0.35));
            el.setAttribute("dominant-baseline", "auto");
          }
        } else {
          el.setAttribute("font-family", SANS_STACK);
        }
      }
      // Halos are drawn with paint-order: stroke, which not every renderer
      // (PDF, some viewers) supports: draw the stroke as its own copy below.
      const stroke = cs.getPropertyValue("stroke");
      if (cs.getPropertyValue("paint-order").startsWith("stroke") && stroke !== "none") {
        const halo = el.cloneNode(true) as SVGElement;
        halo.removeAttribute("class");
        halo.setAttribute("fill", "none");
        el.parentNode!.insertBefore(halo, el);
        el.setAttribute("stroke", "none");
      }
    }
    for (const el of all) {
      el.removeAttribute("class");
      (el as SVGElement).style?.removeProperty("cursor");
      if (el.getAttribute("style") === "") el.removeAttribute("style");
    }
  } finally {
    host.remove();
  }

  const vb = svg.viewBox.baseVal;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(vb.width));
  clone.setAttribute("height", String(vb.height));
  clone.removeAttribute("style");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", String(vb.x));
  bg.setAttribute("y", String(vb.y));
  bg.setAttribute("width", String(vb.width));
  bg.setAttribute("height", String(vb.height));
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);
  return clone;
}

async function svgMarkup(svg: SVGSVGElement): Promise<string> {
  const clone = inlineStyles(svg, false);
  const css = await embeddedFontCss();
  if (css) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function pngBlob(svg: SVGSVGElement): Promise<Blob> {
  const markup = await svgMarkup(svg);
  const vb = svg.viewBox.baseVal;
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vb.width * PNG_SCALE);
    canvas.height = Math.round(vb.height * PNG_SCALE);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(PNG_SCALE, PNG_SCALE);
    ctx.drawImage(img, 0, 0, vb.width, vb.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG export failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function pdfBlob(svg: SVGSVGElement): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const clone = inlineStyles(svg, true);
  const vb = svg.viewBox.baseVal;
  // 1 CSS px = 0.75 pt: the PDF page is the map's own size.
  const w = vb.width * 0.75;
  const h = vb.height * 0.75;
  const doc = new jsPDF({ orientation: w > h ? "landscape" : "portrait", unit: "pt", format: [w, h] });
  // svg2pdf reads layout from the DOM, so the copy must be attached.
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0";
  host.appendChild(clone);
  document.body.appendChild(host);
  try {
    await svg2pdf(clone, doc, { x: 0, y: 0, width: w, height: h });
  } finally {
    host.remove();
  }
  return doc.output("blob");
}

/** Save `svg` as an image file named `<base>.<format>`. */
export async function exportMap(svg: SVGSVGElement, format: ImageFormat, base: string): Promise<void> {
  const name = `${base.replace(/[\\/:*?"<>|]+/g, "_").trim() || "map"}.${format}`;
  if (format === "svg") {
    download(new Blob([await svgMarkup(svg)], { type: "image/svg+xml" }), name);
  } else if (format === "png") {
    download(await pngBlob(svg), name);
  } else {
    download(await pdfBlob(svg), name);
  }
}

/** Print `svg` alone on a page, with a title line. */
export async function printMap(svg: SVGSVGElement, title: string, subtitle: string): Promise<void> {
  const markup = (await svgMarkup(svg)).replace(/^<\?xml[^>]*>\s*/, "");
  const css = await embeddedFontCss();
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${css}
@page { margin: 14mm; }
html, body { margin: 0; background: #fff; color: #1d1f22; font-family: ${SANS_STACK}; }
h1 { font-size: 14pt; font-weight: 600; margin: 0 0 2pt; }
p { font-size: 9.5pt; color: #6b7079; margin: 0 0 10pt; }
svg { display: block; width: 100%; height: auto; max-height: 240mm; }
</style></head><body><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>${markup}</body></html>`);
  doc.close();
  const win = frame.contentWindow!;
  await doc.fonts?.ready;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", cleanup, { once: true });
  win.focus();
  win.print();
  // Some shells don't fire afterprint; never leave the frame behind.
  setTimeout(() => frame.isConnected && frame.remove(), 60_000);
}
