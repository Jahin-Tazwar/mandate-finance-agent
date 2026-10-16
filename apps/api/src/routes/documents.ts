import { type RequestHandler, Router } from "express";
import multer from "multer";
import { ingestDocument } from "../documents";
import { HttpError } from "../http/errors";
import { getPersona } from "../store";

export const documentRoutes = Router();

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Keeps the upload in memory (never written to disk), one file, 5 MB at most
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single("file");

/** Runs multer and turns its errors into clear ones, e.g. too big → 413. */
const receiveFile: RequestHandler = (req, res, next) => {
  upload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      // Reject: too big, or a field we didn't ask for
      next(err.code === "LIMIT_FILE_SIZE" ? new HttpError(413, "The file is too big (max 5 MB)") : new HttpError(400, `Upload problem: ${err.message}`));
      return;
    }
    next(err);
  });
};

// Upload a bill PDF (multipart/form-data, field "file") → what was read, warnings, actions
documentRoutes.post("/personas/:personaId/documents", receiveFile, async (req, res) => {
  const personaId = String(req.params.personaId);
  getPersona(personaId); // 404 if unknown

  // Reject: no file attached
  if (!req.file) throw new HttpError(400, 'Attach a PDF in the "file" field');

  // Reject: not a PDF. Check the first bytes, not the name ("bill.pdf" could be anything)
  if (req.file.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") throw new HttpError(400, "That isn't a PDF");

  res.status(201).json(await ingestDocument(personaId, req.file.buffer, req.file.originalname));
});
