import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface CertificatePdfInput {
  holderName: string;
  courseTitle: string;
  certificateNumber: string;
  issuedAt: Date;
  completionDate: Date | null;
  approvedBy: string | null;
  verificationUrl: string;
}

const COLORS = { ink: '#111827', muted: '#6b7280', accent: '#1d4ed8', border: '#c7d2fe' };
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Landscape A4 certificate with a QR code linking to the public verification page. */
export async function certificatePdf(c: CertificatePdfInput): Promise<Buffer> {
  const qr = await QRCode.toBuffer(c.verificationUrl, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
  const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificate ${c.certificateNumber}`, Creator: 'TrustAI360' } });
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const { width: W, height: H } = pdf.page;
  pdf.rect(24, 24, W - 48, H - 48).lineWidth(3).strokeColor(COLORS.accent).stroke();
  pdf.rect(34, 34, W - 68, H - 68).lineWidth(1).strokeColor(COLORS.border).stroke();

  const center = (text: string, y: number, size: number, font = 'Helvetica', color = COLORS.ink) =>
    pdf.font(font).fontSize(size).fillColor(color).text(text, 60, y, { width: W - 120, align: 'center' });

  center('TRUSTAI360', 70, 12, 'Helvetica-Bold', COLORS.accent);
  center('Certificate of Completion', 100, 34, 'Helvetica-Bold');
  center('This certifies that', 170, 13, 'Helvetica', COLORS.muted);
  center(c.holderName, 195, 30, 'Helvetica-Bold');
  center('has successfully completed the course', 245, 13, 'Helvetica', COLORS.muted);
  center(c.courseTitle, 270, 20, 'Helvetica-Bold', COLORS.accent);
  center(
    'including the course modules, required labs, quizzes, the final certification exam and graded practical assignments, with faculty approval.',
    310,
    10,
    'Helvetica',
    COLORS.muted,
  );

  const left = 80;
  const y = 380;
  const field = (label: string, value: string, dy: number) => {
    pdf.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text(label.toUpperCase(), left, y + dy);
    pdf.font('Helvetica').fontSize(11).fillColor(COLORS.ink).text(value, left, y + dy + 11);
  };
  field('Certificate number', c.certificateNumber, 0);
  field('Date issued', day(c.issuedAt), 34);
  if (c.completionDate) field('Course completed', day(c.completionDate), 68);
  if (c.approvedBy) field('Approved by', c.approvedBy, c.completionDate ? 102 : 68);

  const qrSize = 110;
  const qrX = W - 80 - qrSize;
  pdf.image(qr, qrX, y - 4, { width: qrSize, height: qrSize });
  pdf.font('Helvetica').fontSize(7).fillColor(COLORS.muted).text('Scan or visit to verify', qrX - 40, y + qrSize, { width: qrSize + 80, align: 'center' });
  pdf.text(c.verificationUrl, qrX - 90, y + qrSize + 10, { width: qrSize + 130, align: 'center' });

  center(
    'This certificate attests completion of an educational programme. It is not a professional licence and does not certify that any AI system complies with legal or regulatory requirements.',
    H - 70,
    7.5,
    'Helvetica-Oblique',
    COLORS.muted,
  );
  pdf.end();
  return done;
}
