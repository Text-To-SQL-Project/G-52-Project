// Result exports: CSV, PDF (browser print → "Save as PDF") and Word (.docx).
// No libraries: a .docx is a zip of three XML files, written here uncompressed.
import type { ResultTable, StudentProfile } from "./types/api";

type Cell = unknown;

/** A rendered chart: PNG bytes for Word and downloads, data URL for print. */
export interface ChartImage {
  png: Uint8Array;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ExportDoc {
  image?: ChartImage; // chart drawn above the table
  title: string;
  subtitle?: string;
  fields?: [string, string][]; // label/value pairs above the table
  columns: string[];
  rows: Cell[][];
  footer?: string;
}

const text = (v: Cell) => (v === null || v === undefined ? "" : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v));
/** Document cell: booleans read as Yes/No (CSV keeps the raw value). */
const cellText = (v: Cell) => (typeof v === "boolean" ? (v ? "Yes" : "No") : text(v));
/** "marks_obtained" → "Marks obtained" for document headers. */
const heading = (c: string) => c.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

export function download(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── CSV ──────────────────────────────────────────────────────────────────
export function exportCsv(r: ResultTable) {
  const q = (v: Cell) => {
    const s = text(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [r.columns.map(q).join(","), ...r.rows.map((row) => row.map(q).join(","))].join("\n");
  download(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }), `query_results_${stamp()}.csv`);
}

// ── PDF: one printable page, printed from a hidden iframe ────────────────
function html(d: ExportDoc): string {
  const fields = (d.fields ?? []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
  const head = d.columns.map((c) => `<th>${esc(heading(c))}</th>`).join("");
  const body = d.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(cellText(c))}</td>`).join("")}</tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11px/1.5 Inter, system-ui, sans-serif; color: #16181d; margin: 0; }
  header { border-bottom: 2px solid #a83a0d; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font: 10px/1 "JetBrains Mono", monospace; letter-spacing: .08em; text-transform: uppercase; color: #a83a0d; }
  h1 { font: 30px/1.1 "Instrument Serif", Georgia, serif; margin: 8px 0 2px; }
  .sub { color: #45464b; margin: 0; }
  dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 18px; margin: 0 0 18px; }
  dt { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #63625c; }
  dd { margin: 2px 0 0; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #45464b; border-bottom: 1px solid #16181d; padding: 6px 8px; }
  td { padding: 6px 8px; border-bottom: 1px solid #e3ded3; }
  tr { break-inside: avoid; }
  footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e3ded3; color: #63625c; font-size: 9.5px; }
</style></head><body>
<header><div class="brand">SQL.AI Guardrails · College ERP</div><h1>${esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${esc(d.subtitle)}</p>` : ""}</header>
${fields ? `<dl>${fields}</dl>` : ""}
${d.image ? `<img src="${d.image.dataUrl}" alt="Chart" style="display:block;width:100%;margin:0 0 18px">` : ""}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${d.footer ? `<footer>${esc(d.footer)}</footer>` : ""}
</body></html>`;
}

export function printPdf(d: ExportDoc) {
  const frame = Object.assign(document.createElement("iframe"), { srcdoc: html(d) });
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  frame.onload = async () => {
    const w = frame.contentWindow!;
    await w.document.fonts?.ready; // print with the real fonts, not fallbacks
    w.focus();
    w.print();
    setTimeout(() => frame.remove(), 60_000); // print dialogs can stay open a while
  };
  document.body.appendChild(frame);
}

// ── DOCX ─────────────────────────────────────────────────────────────────
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Minimal zip (stored, no compression): enough for Word to open. */
function zip(files: Record<string, string | Uint8Array>): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const n = enc.encode(name);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, n.length, 2]]
      .forEach(([o, v, s]) => (s === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true)));
    const dir = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, n.length, 2], [42, offset, 4]]
      .forEach(([o, v, s]) => (s === 4 ? dir.setUint32(o, v, true) : dir.setUint16(o, v, true)));
    parts.push(new Uint8Array(local.buffer), n, data);
    central.push(new Uint8Array(dir.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  const count = Object.keys(files).length;
  [[0, 0x06054b50, 4], [8, count, 2], [10, count, 2], [12, size, 4], [16, offset, 4]]
    .forEach(([o, v, s]) => (s === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

const run = (t: string, o: { bold?: boolean; size?: number; color?: string; serif?: boolean } = {}) =>
  `<w:r><w:rPr>${o.serif ? '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>' : ""}${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
const para = (runs: string, after = 120) => `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>${runs}</w:p>`;
const tcell = (t: string, bold = false) => `<w:tc><w:p>${run(t, { bold, size: 18 })}</w:p></w:tc>`;

/** Inline picture filling the text width (A4 minus margins, in EMU). */
function picture(img: ChartImage): string {
  const cx = 6_400_000;
  const cy = Math.round((cx * img.height) / img.width);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdChart"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

export function exportDocx(d: ExportDoc) {
  const border = (s: string) => `<w:${s} w:val="single" w:sz="4" w:color="D8D2C6"/>`;
  const table = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "bottom", "insideH"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tr><w:trPr><w:tblHeader/></w:trPr>${d.columns.map((c) => tcell(heading(c), true)).join("")}</w:tr>
${d.rows.map((r) => `<w:tr>${r.map((c) => tcell(cellText(c))).join("")}</w:tr>`).join("")}</w:tbl>`;
  const body = [
    para(run("SQL.AI GUARDRAILS · COLLEGE ERP", { size: 16, color: "A83A0D", bold: true }), 60),
    para(run(d.title, { size: 44, serif: true }), 60),
    d.subtitle ? para(run(d.subtitle, { size: 20, color: "45464B" }), 240) : "",
    ...(d.fields ?? []).map(([k, v]) => para(run(`${k}: `, { size: 20, color: "63625C" }) + run(v, { size: 20, bold: true }), 40)),
    d.fields?.length ? para("", 120) : "",
    d.image ? para(picture(d.image), 200) : "",
    table,
    d.footer ? para("", 120) + para(run(d.footer, { size: 16, color: "63625C" })) : "",
  ].join("");
  download(
    zip({
      "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      "word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="900" w:bottom="1000" w:left="900"/></w:sectPr></w:body></w:document>`,
      ...(d.image
        ? {
            "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/chart.png"/></Relationships>`,
            "word/media/chart.png": d.image.png,
          }
        : {}),
    }),
    `${d.title.toLowerCase().replace(/\W+/g, "_")}_${stamp()}.docx`,
  );
}

// ── Chart → image ────────────────────────────────────────────────────────
const SVG_NS = "http://www.w3.org/2000/svg";

/** Renders an on-screen recharts SVG to a 2x PNG on white. Theme CSS
 * variables don't survive serialisation, so every colour is resolved here;
 * text and grid always use print colours, so a dark-theme chart still reads
 * on paper. The legend (HTML in recharts) is redrawn under the plot. */
export async function chartImage(svg: SVGSVGElement): Promise<ChartImage> {
  const { width, height: plotH } = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = svg.querySelectorAll("*");
  clone.querySelectorAll("*").forEach((el, i) => {
    const src = from[i];
    const cs = getComputedStyle(src);
    if (el.tagName === "text" || el.tagName === "tspan") {
      el.setAttribute("fill", "#45464b");
      el.setAttribute("font-family", "Inter, Arial, sans-serif");
      el.setAttribute("font-size", cs.fontSize);
    } else {
      el.setAttribute("fill", cs.fill);
      const lines = src.closest(".recharts-cartesian-grid, .recharts-cartesian-axis");
      el.setAttribute("stroke", cs.stroke === "none" ? "none" : lines ? "#d8d2c6" : cs.stroke);
    }
  });

  const legend = [...(svg.closest(".recharts-wrapper")?.querySelectorAll(".recharts-legend-item") ?? [])].map((item) => ({
    label: item.textContent?.trim() ?? "",
    color: getComputedStyle(item.querySelector("path, rect") ?? item).fill,
  }));
  // recharts already reserves the legend's space inside the SVG; draw it there.
  const height = plotH;
  const ly = plotH - 22;
  let x = 16;
  for (const { label, color } of legend) {
    const sw = document.createElementNS(SVG_NS, "rect");
    Object.entries({ x, y: ly, width: 10, height: 10, rx: 2, fill: color }).forEach(([k, v]) => sw.setAttribute(k, String(v)));
    const t = document.createElementNS(SVG_NS, "text");
    Object.entries({ x: x + 15, y: ly + 9, fill: "#16181d", "font-size": 12, "font-family": "Inter, Arial, sans-serif" }).forEach(([k, v]) => t.setAttribute(k, String(v)));
    t.textContent = label.replace(/_/g, " ");
    clone.append(sw, t);
    x += 30 + label.length * 7;
  }
  const bg = document.createElementNS(SVG_NS, "rect");
  Object.entries({ width: "100%", height: "100%", fill: "#ffffff" }).forEach(([k, v]) => bg.setAttribute(k, v));
  clone.prepend(bg);
  Object.entries({ xmlns: SVG_NS, width, height, viewBox: `0 0 ${width} ${height}` }).forEach(([k, v]) => clone.setAttribute(k, String(v)));

  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  await img.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: width * 2, height: height * 2 });
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("PNG encode failed"))), "image/png"));
  return { png: new Uint8Array(await blob.arrayBuffer()), dataUrl: canvas.toDataURL("image/png"), width, height };
}

export const downloadPng = (img: ChartImage) => download(new Blob([img.png as BlobPart], { type: "image/png" }), `chart_${stamp()}.png`);

// ── What to export ───────────────────────────────────────────────────────
/** Columns that make a result set look like a student's academic result. */
export const isResultQuery = (columns: string[]) =>
  columns.some((c) => /mark|grade|gpa|score|percent|result|credit|attendance/i.test(c));

export function resultsDoc(r: ResultTable, question?: string): ExportDoc {
  return {
    title: "Query Results",
    subtitle: question,
    columns: r.columns,
    rows: r.rows,
    footer: `${r.row_count} row${r.row_count === 1 ? "" : "s"}${r.truncated ? " (capped)" : ""} · exported ${new Date().toLocaleString()}`,
  };
}

export function certificateDoc(r: ResultTable, s: StudentProfile, queryId: string, question?: string): ExportDoc {
  return {
    title: "Statement of Results",
    subtitle: question ? `For: “${question}”` : undefined,
    fields: [
      ["Student", s.name],
      ["PRN", s.prn],
      ["Roll number", s.roll],
      ["Programme", s.program],
      ["Department", s.department],
      ["Current semester", String(s.semester)],
    ],
    columns: r.columns,
    rows: r.rows,
    footer:
      `Issued ${new Date().toLocaleString()} · Reference ${queryId}. ` +
      "Generated by the system from the college ERP database and limited to this student's own records by row-level security. " +
      "This is a system-generated statement, not an official transcript.",
  };
}
