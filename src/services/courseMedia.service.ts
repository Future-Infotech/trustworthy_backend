import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../middleware/authorize';
import { Errors } from '../utils/errors';
import { auditService } from './audit.service';
import { getStorage } from './storage';

interface MediaKind {
  ext: string;
  contentType: string;
  kind: 'video' | 'image' | 'document';
  /** Checks the file signature so a renamed file cannot masquerade as another type. */
  matches: (b: Buffer) => boolean;
}

const startsWith = (b: Buffer, bytes: number[], offset = 0) => bytes.every((v, i) => b[offset + i] === v);

/**
 * Only inert media types are accepted. SVG, HTML and Office files are excluded on purpose:
 * SVG/HTML can carry script and Office files cannot be rendered in the browser (export slides as PDF).
 */
const KINDS: MediaKind[] = [
  { ext: 'mp4', contentType: 'video/mp4', kind: 'video', matches: (b) => b.length > 12 && b.toString('latin1', 4, 8) === 'ftyp' },
  { ext: 'webm', contentType: 'video/webm', kind: 'video', matches: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) },
  { ext: 'pdf', contentType: 'application/pdf', kind: 'document', matches: (b) => b.toString('latin1', 0, 5) === '%PDF-' },
  { ext: 'png', contentType: 'image/png', kind: 'image', matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]) },
  { ext: 'jpg', contentType: 'image/jpeg', kind: 'image', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { ext: 'webp', contentType: 'image/webp', kind: 'image', matches: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { ext: 'gif', contentType: 'image/gif', kind: 'image', matches: (b) => b.toString('latin1', 0, 4) === 'GIF8' },
];

const KEY_PATTERN = /^[a-f0-9-]{36}\.(mp4|webm|pdf|png|jpg|webp|gif)$/;
const PREFIX = 'course-media/';

export const courseMediaService = {
  async upload(auth: AuthContext, file: Express.Multer.File | undefined) {
    if (!file) throw Errors.badRequest('Attach a file in the "file" field');
    const type = KINDS.find((k) => k.matches(file.buffer));
    if (!type) throw Errors.badRequest('Unsupported file. Upload an MP4 or WebM video, a PDF, or a PNG, JPEG, WebP or GIF image');
    const name = `${randomUUID()}.${type.ext}`;
    const stored = await getStorage().put(`${PREFIX}${name}`, file.buffer, type.contentType);
    await auditService.record({
      action: 'course.media.upload',
      resource: 'course_media',
      resourceId: name,
      actor: auth.actor,
      context: auth.ctx,
      metadata: { originalName: file.originalname.slice(0, 200), contentType: type.contentType, sizeBytes: stored.sizeBytes },
    });
    return { url: `/api/course-media/${name}`, kind: type.kind, contentType: type.contentType, sizeBytes: stored.sizeBytes, name: file.originalname.slice(0, 200) };
  },

  /** Resolves an uploaded file for streaming. Keys are unguessable UUIDs, so the URL itself is the capability. */
  async read(name: string) {
    if (!KEY_PATTERN.test(name)) throw Errors.notFound('Media');
    const key = `${PREFIX}${name}`;
    const storage = getStorage();
    if (!(await storage.exists(key))) throw Errors.notFound('Media');
    const type = KINDS.find((k) => k.ext === name.split('.').pop())!;
    return { body: await storage.get(key), contentType: type.contentType, kind: type.kind };
  },
};
