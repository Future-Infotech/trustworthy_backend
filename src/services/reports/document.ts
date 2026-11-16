import PDFDocument from 'pdfkit';

type Cell = string | number | null | undefined;

export interface ReportSection {
  heading: string;
  /** Label/value pairs rendered as a definition list. */
  fields?: [string, Cell][];
  paragraphs?: string[];
  bullets?: string[];
  table?: { headers: string[]; rows: Cell[][] };
}

/** Format-neutral document rendered to Markdown or PDF so every export shows the same content. */
export interface ReportDocument {
  title: string;
  subtitle?: string;
  /** Shown prominently on drafts and unreviewed documents. */
  watermark?: string;
  meta: [string, Cell][];
  sections: ReportSection[];
  disclaimer?: string;
  generatedAt: Date;
}

const show = (v: Cell) => (v === null || v === undefined || v === '' ? '—' : String(v));
const mdEscape = (v: Cell) => show(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function toMarkdown(doc: ReportDocument): string {
  const out: string[] = [`# ${doc.title}`];
  if (doc.subtitle) out.push('', `_${doc.subtitle}_`);
  if (doc.watermark) out.push('', `> **${doc.watermark}**`);
  out.push('', ...doc.meta.map(([k, v]) => `- **${k}:** ${show(v)}`));
  for (const s of doc.sections) {
    out.push('', `## ${s.heading}`, '');
    for (const [k, v] of s.fields ?? []) out.push(`**${k}**`, '', show(v), '');
    for (const p of s.paragraphs ?? []) out.push(p, '');
    for (const b of s.bullets ?? []) out.push(`- ${b}`);
    if (s.bullets?.length) out.push('');
    if (s.table && s.table.rows.length) {
      out.push(`| ${s.table.headers.map(mdEscape).join(' | ')} |`, `| ${s.table.headers.map(() => '---').join(' | ')} |`);
      for (const row of s.table.rows) out.push(`| ${row.map(mdEscape).join(' | ')} |`);
      out.push('');
    }
  }
  if (doc.disclaimer) out.push('---', '', `_${doc.disclaimer}_`, '');
  out.push(`_Generated ${doc.generatedAt.toISOString()}_`, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

const MARGIN = 50;
const COLORS = { text: '#111827', muted: '#6b7280', accent: '#1d4ed8', rule: '#e5e7eb', warn: '#b45309' };

export function toPdf(doc: ReportDocument): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: MARGIN, info: { Title: doc.title, Creator: 'TrustAI360' }, bufferPages: true });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  const width = pdf.page.width - MARGIN * 2;

  const ensureSpace = (h: number) => {
    if (pdf.y + h > pdf.page.height - MARGIN - 20) pdf.addPage();
  };

  pdf.fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(20).text(doc.title, { width });
  if (doc.subtitle) pdf.moveDown(0.2).fillColor(COLORS.muted).font('Helvetica').fontSize(11).text(doc.subtitle, { width });
  if (doc.watermark) {
    pdf.moveDown(0.6).fillColor(COLORS.warn).font('Helvetica-Bold').fontSize(11).text(doc.watermark, { width });
  }
  pdf.moveDown(0.6);
  for (const [k, v] of doc.meta) {
    pdf.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9).text(`${k}: `, { continued: true }).font('Helvetica').fillColor(COLORS.text).text(show(v));
  }

  for (const s of doc.sections) {
    ensureSpace(60);
    pdf.moveDown(1).fillColor(COLORS.accent).font('Helvetica-Bold').fontSize(13).text(s.heading, { width });
    const y = pdf.y + 2;
    pdf.moveTo(MARGIN, y).lineTo(MARGIN + width, y).strokeColor(COLORS.rule).stroke();
    pdf.moveDown(0.5);
    for (const [k, v] of s.fields ?? []) {
      ensureSpace(30);
      pdf.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9).text(k.toUpperCase(), { width });
      pdf.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(show(v), { width }).moveDown(0.5);
    }
    for (const p of s.paragraphs ?? []) pdf.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(p, { width }).moveDown(0.4);
    for (const b of s.bullets ?? []) pdf.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(`•  ${b}`, { width, indent: 6 }).moveDown(0.2);
    if (s.table && s.table.rows.length) drawTable(pdf, s.table, width, ensureSpace);
  }

  if (doc.disclaimer) {
    ensureSpace(50);
    pdf.moveDown(1).fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(9).text(doc.disclaimer, { width });
  }

  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    const footer = `${doc.title} · generated ${doc.generatedAt.toISOString()} · page ${i + 1} of ${range.count}`;
    pdf.fillColor(COLORS.muted).font('Helvetica').fontSize(8).text(footer, MARGIN, pdf.page.height - MARGIN + 10, { width, align: 'center', lineBreak: false });
  }
  pdf.end();
  return done;
}

function drawTable(pdf: PDFKit.PDFDocument, table: NonNullable<ReportSection['table']>, width: number, ensureSpace: (h: number) => void) {
  const colWidth = width / table.headers.length;
  const row = (cells: Cell[], bold: boolean) => {
    const heights = cells.map((c) => pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).heightOfString(show(c), { width: colWidth - 6 }));
    const h = Math.max(...heights) + 6;
    ensureSpace(h);
    const y = pdf.y;
    cells.forEach((c, i) => {
      pdf.fillColor(bold ? COLORS.muted : COLORS.text).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(show(c), MARGIN + i * colWidth + 3, y + 3, { width: colWidth - 6 });
    });
    pdf.moveTo(MARGIN, y + h).lineTo(MARGIN + width, y + h).strokeColor(COLORS.rule).stroke();
    pdf.x = MARGIN;
    pdf.y = y + h;
  };
  pdf.moveDown(0.3);
  row(table.headers, true);
  for (const r of table.rows) row(r, false);
  pdf.moveDown(0.5);
}
