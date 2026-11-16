import type { RequestHandler } from 'express';
import multer from 'multer';
import { settingsService } from '../services/settings.service';
import { AppError, Errors } from '../utils/errors';

type SizeSetting = 'uploads.maxDatasetSizeMb' | 'uploads.maxModelSizeMb';

/**
 * Accepts one multipart file into memory, capped by the size limit from system settings.
 * Files are validated by the services and stored as data; nothing uploaded is ever executed.
 */
export function singleFileUpload(field: string, sizeSetting: SizeSetting): RequestHandler {
  return (req, res, next) => {
    settingsService
      .get(sizeSetting)
      .then((maxMb) => {
        const upload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 20, fieldSize: 64 * 1024, parts: 25 },
        }).single(field);
        upload(req, res, (err: unknown) => {
          if (!err) return next();
          if (err instanceof multer.MulterError) {
            return next(
              err.code === 'LIMIT_FILE_SIZE'
                ? new AppError(413, 'PAYLOAD_TOO_LARGE', `The file exceeds the ${maxMb} MB upload limit`)
                : Errors.badRequest(err.code === 'LIMIT_UNEXPECTED_FILE' ? `Upload the file in the "${field}" field` : err.message),
            );
          }
          next(err);
        });
      })
      .catch(next);
  };
}
