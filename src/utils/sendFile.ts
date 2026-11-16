import type { Response } from 'express';

/** Sends a download with a sanitised file name; content is never sniffed or rendered inline. */
export function sendFile(res: Response, body: Buffer, fileName: string, contentType: string) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/["\\\r\n]/g, '_')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}
