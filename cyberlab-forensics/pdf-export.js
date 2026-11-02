/* Minimal dependency-free PDF writer for CyberLab reports.
 * Consumes the neutral block list from CyberLabEngine.reportBlocks so PDF and TXT always match.
 * Output: A4, built-in Courier / Helvetica fonts, Latin-1 text only (other characters become "?"). */
(function (root) {
'use strict';
const PAGE = { w: 595, h: 842, m: 48 }, SIZE = 9, LEAD = 13, COLS = Math.floor((PAGE.w - PAGE.m * 2) / (SIZE * 0.6));
const clean = s => String(s).replace(/[\u2014\u2013]/g, '-').replace(/\u2026/g, '...').replace(/\u00d7/g, 'x').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e]/g, '?');
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
function wrap(text, width) {
  const out = []; for (const para of clean(text).split('\n')) {
    let line = ''; for (let word of para.split(' ')) {
      while (word.length > width) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, width)); word = word.slice(width); }
      if ((line + ' ' + word).trim().length > width) { out.push(line); line = word; } else line = (line ? line + ' ' : '') + word;
    } out.push(line);
  } return out;
}
function build(r, blocks) {
  const pages = [[]]; let y = PAGE.h - PAGE.m - 30;
  const cur = () => pages[pages.length - 1];
  const need = n => { if (y - n < PAGE.m + 20) { pages.push([]); y = PAGE.h - PAGE.m; } };
  const text = (font, size, str, x, color) => { cur().push(`BT /${font} ${size} Tf ${color || '0.1 0.12 0.15'} rg ${x} ${y} Td (${esc(str)}) Tj ET`); };
  const lvl = { Minimal: '0.2 0.7 0.55', Low: '0.2 0.7 0.55', Moderate: '0.85 0.6 0.2', Elevated: '0.9 0.4 0.2', High: '0.85 0.2 0.3' }[r.score.level];
  cur().push(`0.06 0.09 0.12 rg ${PAGE.m - 12} ${PAGE.h - PAGE.m - 34} ${PAGE.w - PAGE.m * 2 + 24} 46 re f`, `${lvl} rg ${PAGE.m - 12} ${PAGE.h - PAGE.m - 34} 6 46 re f`);
  cur().push(`BT /F2 15 Tf 1 1 1 rg ${PAGE.m + 6} ${PAGE.h - PAGE.m - 8} Td (${esc('CYBERLAB // STATIC ANALYSIS REPORT')}) Tj ET`, `BT /F1 8 Tf 0.6 0.9 0.8 rg ${PAGE.m + 6} ${PAGE.h - PAGE.m - 24} Td (${esc(clean('Case ' + r.caseId + '   |   NOT EXECUTED   |   heuristic, not a verdict'))}) Tj ET`);
  y -= 22;
  for (const b of blocks) {
    if (b.t === 'title') continue;
    if (b.t === 'h') { need(40); y -= 10; text('F2', 10, clean(b.v), PAGE.m, '0.05 0.45 0.37'); cur().push(`0.75 0.8 0.82 RG ${PAGE.m} ${y - 4} m ${PAGE.w - PAGE.m} ${y - 4} l S`); y -= LEAD + 2; continue; }
    const prefix = b.t === 'kv' ? b.k + ': ' : b.t === 'li' ? '- ' : '', indent = b.t === 'sub' ? 14 : b.t === 'li' ? 6 : 0;
    const lines = wrap(prefix + b.v, COLS - Math.ceil(indent / (SIZE * 0.6)) - (b.t === 'li' ? 2 : 0));
    lines.forEach((l, i) => { need(LEAD); const x = PAGE.m + indent + (b.t === 'li' && i ? 10 : 0); text('F1', b.t === 'sub' ? 8 : SIZE, l, x, b.t === 'sub' ? '0.35 0.4 0.43' : undefined); y -= LEAD; });
    if (b.t === 'li') y -= 1;
  }
  pages.forEach((p, i) => p.push(`BT /F1 7 Tf 0.5 0.55 0.6 rg ${PAGE.m} 28 Td (${esc('CyberLab Forensics Workbench - static analysis only - page ' + (i + 1) + ' of ' + pages.length)}) Tj ET`));
  // Assemble objects: 1 catalog, 2 pages, 3 Courier, 4 Courier-Bold? (title uses F2), 5.. page+content pairs
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  const kids = [];
  pages.forEach(p => { const content = p.join('\n'), c = objs.length + 2; kids.push(`${objs.length + 1} 0 R`); objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${c} 0 R >>`); objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`); });
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let pdf = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length; pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf; // all characters are ASCII, so string length equals byte length
}
const api = { build };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CyberLabPDF = api;
})(typeof window !== 'undefined' ? window : globalThis);
