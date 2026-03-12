import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { ValidationError, StorageError } from '../types/errors.js';
import { DecryptionError } from '../crypto/errors.js';

/**
 * Error codes returned by the API.
 */
export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_ERROR';

/**
 * Error type used for consistent API responses.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

/**
 * Express middleware for returning consistent JSON errors.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const apiError = toApiError(error);
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
    },
  });
}

/**
 * Express middleware for unknown routes.
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
  });
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof ZodError || error instanceof ValidationError) {
    return new ApiError(400, 'INVALID_REQUEST', error.message);
  }

  if (error instanceof DecryptionError) {
    return new ApiError(401, 'UNAUTHORIZED', 'Invalid secret or token');
  }

  if (error instanceof StorageError) {
    if (/not found/i.test(error.message)) {
      return new ApiError(404, 'NOT_FOUND', 'Blob not found');
    }
    // Surface the underlying storage message so the UI can show e.g. permission/path errors
    const message = error.message && error.message.length > 0
      ? error.message
      : 'Storage error';
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }

  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Upload exceeds maximum size');
    }
    return new ApiError(400, 'INVALID_REQUEST', 'Invalid multipart upload');
  }

  if (error instanceof SyntaxError) {
    return new ApiError(400, 'INVALID_REQUEST', 'Invalid JSON body');
  }

  return new ApiError(500, 'INTERNAL_ERROR', 'Unexpected server error');
}
