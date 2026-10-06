import QRCode from "qrcode";

/**
 * A deliberately small PDF 1.4 writer: one A4 page, the two standard Helvetica
 * fonts, text lines, filled rectangles and a QR code drawn as squares. No new
 * dependency — the QR matrix comes from the `qrcode` package already installed
 * for gate passes.
 *
 * `meta.canonical` is stored base64-encoded in the document information
 * dictionary under /NexCanonical (files issued before the NeX Camp rename use /CIOCanonical; both are read), so a copy of the file can be re-checked
 * against the issued digest (see certificateService.verifyCopy).
 */

const A4 = { w: 595.28, h: 841.89 };

// PDF literal strings are bytes in WinAnsiEncoding. Map the few non-ASCII
// characters the certificate uses, drop anything else rather than corrupt it.
const WIN_ANSI = { "·": 0xb7, "—": 0x97, "–": 0x96, "’": 0x92, "“": 0x93, "”": 0x94, "₹": null, "•": 0x95 };

function encodeText(text) {
  const bytes = [];
  for (const ch of String(text ?? "")) {
    let code = ch.codePointAt(0);
    if (code > 0x7e) {
      if (ch in WIN_ANSI) code = WIN_ANSI[ch];
      else if (code <= 0xff) code = code; // Latin-1 range matches WinAnsi here
      else code = 0x3f; // "?"
      if (code === null) continue;
    }
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c);
    bytes.push(code);
  }
  return Buffer.from(bytes).toString("latin1");
}

const n = (value) => Number(value).toFixed(2).replace(/\.00$/, "");

/**
 * @param {Array} items  { kind: "text", x, y, size, bold, text, color? }
 *                       { kind: "rect", x, y, w, h, color? , stroke? }
 *                       { kind: "qr", x, y, size, value }
 */
export async function buildPdf(items, meta = {}) {
  const ops = [];
  for (const item of items) {
    const [r, g, b] = item.color || [0.125, 0.118, 0.114];
    if (item.kind === "text") {
      ops.push(`${n(r)} ${n(g)} ${n(b)} rg BT /${item.bold ? "F2" : "F1"} ${n(item.size || 11)} Tf ${n(item.x)} ${n(item.y)} Td (${encodeText(item.text)}) Tj ET`);
    } else if (item.kind === "rect") {
      if (item.stroke) ops.push(`${n(r)} ${n(g)} ${n(b)} RG ${n(item.stroke)} w ${n(item.x)} ${n(item.y)} ${n(item.w)} ${n(item.h)} re S`);
      else ops.push(`${n(r)} ${n(g)} ${n(b)} rg ${n(item.x)} ${n(item.y)} ${n(item.w)} ${n(item.h)} re f`);
    } else if (item.kind === "qr") {
      const qr = QRCode.create(String(item.value), { errorCorrectionLevel: "M" });
      const { size, data } = qr.modules;
      const cell = item.size / size;
      ops.push("0.125 0.118 0.114 rg");
      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          if (data[row * size + col]) {
            ops.push(`${n(item.x + col * cell)} ${n(item.y + item.size - (row + 1) * cell)} ${n(cell + 0.02)} ${n(cell + 0.02)} re f`);
          }
        }
      }
    }
  }
  const content = ops.join("\n");

  const info = [
    `/Title (${encodeText(meta.title || "Certificate")})`,
    `/Producer (NeX Camp)`,
    meta.canonical ? `/NexCanonical (${Buffer.from(meta.canonical, "utf8").toString("base64")})` : null,
    meta.digest ? `/NexDigest (${meta.digest})` : null
  ]
    .filter(Boolean)
    .join(" ");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    `<< ${info} >>`
  ];

  let body = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Pulls the canonical block back out of a PDF produced by buildPdf. */
export function extractCanonical(pdfText) {
  const match = /\/(?:Nex|CIO)Canonical \(([A-Za-z0-9+/=]+)\)/.exec(String(pdfText || ""));
  return match ? Buffer.from(match[1], "base64").toString("utf8") : null;
}

export const PAGE = A4;
