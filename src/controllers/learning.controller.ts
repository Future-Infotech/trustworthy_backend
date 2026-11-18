import type { Request, Response } from 'express';
import { authContext } from '../middleware/authorize';
import { courseMediaService } from '../services/courseMedia.service';
import { courseService } from '../services/course.service';
import { labService } from '../services/lab.service';
import { quizService } from '../services/quiz.service';
import type { ListCoursesQuery } from '../validators/learning.validators';

export const courseController = {
  list: async (req: Request, res: Response) => res.json(await courseService.list(authContext(req), req.query as unknown as ListCoursesQuery)),
  get: async (req: Request, res: Response) => res.json(await courseService.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await courseService.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await courseService.update(authContext(req), req.params.id, req.body)),
  enroll: async (req: Request, res: Response) => res.status(201).json(await courseService.enroll(authContext(req), req.params.id)),
  analytics: async (req: Request, res: Response) => res.json(await courseService.analytics(req.params.id)),
  addModule: async (req: Request, res: Response) => res.status(201).json(await courseService.addModule(authContext(req), req.params.id, req.body)),
  reorderModules: async (req: Request, res: Response) => {
    await courseService.reorderModules(authContext(req), req.params.id, req.body.ids);
    res.status(204).end();
  },
  updateModule: async (req: Request, res: Response) => res.json(await courseService.updateModule(authContext(req), req.params.id, req.body)),
  deleteModule: async (req: Request, res: Response) => {
    await courseService.deleteModule(authContext(req), req.params.id);
    res.status(204).end();
  },
  addLesson: async (req: Request, res: Response) => res.status(201).json(await courseService.addLesson(authContext(req), req.params.id, req.body)),
  reorderLessons: async (req: Request, res: Response) => {
    await courseService.reorderLessons(authContext(req), req.params.id, req.body.ids);
    res.status(204).end();
  },
  uploadMedia: async (req: Request, res: Response) => res.status(201).json(await courseMediaService.upload(authContext(req), req.file)),
  getLesson: async (req: Request, res: Response) => res.json(await courseService.getLesson(authContext(req), req.params.id)),
  updateLesson: async (req: Request, res: Response) => res.json(await courseService.updateLesson(authContext(req), req.params.id, req.body)),
  deleteLesson: async (req: Request, res: Response) => {
    await courseService.deleteLesson(authContext(req), req.params.id);
    res.status(204).end();
  },
  recordProgress: async (req: Request, res: Response) => res.json(await courseService.recordProgress(authContext(req), req.params.id, req.body)),
  knowledgeCheck: async (req: Request, res: Response) => res.json(await courseService.answerKnowledgeCheck(authContext(req), req.params.id, req.body)),
};

export const quizController = {
  list: async (req: Request, res: Response) => res.json(await quizService.list(authContext(req), req.query.courseId as string | undefined)),
  get: async (req: Request, res: Response) => res.json(await quizService.get(authContext(req), req.params.id)),
  create: async (req: Request, res: Response) => res.status(201).json(await quizService.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await quizService.update(authContext(req), req.params.id, req.body)),
  start: async (req: Request, res: Response) => res.status(201).json(await quizService.start(authContext(req), req.params.id)),
  viewAttempt: async (req: Request, res: Response) => res.json(await quizService.view(authContext(req), req.params.id)),
  submit: async (req: Request, res: Response) => res.json(await quizService.submit(authContext(req), req.params.id, req.body.answers)),
  addQuestion: async (req: Request, res: Response) => res.status(201).json(await quizService.addQuestion(authContext(req), req.params.id, req.body)),
  updateQuestion: async (req: Request, res: Response) => res.json(await quizService.updateQuestion(authContext(req), req.params.id, req.body)),
  deactivateQuestion: async (req: Request, res: Response) => res.json(await quizService.deactivateQuestion(authContext(req), req.params.id)),
};

export const labController = {
  list: async (req: Request, res: Response) => res.json(await labService.list(authContext(req))),
  get: async (req: Request, res: Response) => res.json(await labService.get(authContext(req), req.params.idOrSlug)),
  create: async (req: Request, res: Response) => res.status(201).json(await labService.create(authContext(req), req.body)),
  update: async (req: Request, res: Response) => res.json(await labService.update(authContext(req), req.params.id, req.body)),
  start: async (req: Request, res: Response) => res.status(201).json(await labService.startAttempt(authContext(req), req.params.id)),
  complete: async (req: Request, res: Response) => res.json(await labService.complete(authContext(req), req.params.id, req.body)),
};

const RANGE = /^bytes=(\d*)-(\d*)$/;

/** Streams uploaded lesson media with byte-range support so video can seek and resume. */
export const courseMediaController = {
  serve: async (req: Request, res: Response) => {
    const { body, contentType } = await courseMediaService.read(req.params.file);
    const total = body.length;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    // The default API policy forbids framing; PDFs are shown in an iframe on our own origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    const range = req.headers.range ? RANGE.exec(req.headers.range) : null;
    if (!range || (range[1] === '' && range[2] === '')) {
      res.setHeader('Content-Length', total);
      return res.status(200).end(body);
    }
    let start: number;
    let end: number;
    if (range[1] === '') {
      // Suffix range: the last N bytes.
      start = Math.max(0, total - Number(range[2]));
      end = total - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === '' ? total - 1 : Math.min(Number(range[2]), total - 1);
    }
    if (start >= total || start > end) {
      res.setHeader('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', end - start + 1);
    return res.status(206).end(body.subarray(start, end + 1));
  },
};
