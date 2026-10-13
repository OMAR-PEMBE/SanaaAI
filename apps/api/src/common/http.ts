import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ZodType } from 'zod';

export class ApiError extends HttpException {
  retryAfter?: number;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(
      { error: { code, message, ...(details ? { details } : {}) } },
      status,
    );
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fields[issue.path.join('.') || 'body'] = issue.message;
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the form and try again.', { fields });
  }
  return result.data;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      if (exception.retryAfter) response.setHeader('Retry-After', String(exception.retryAfter));
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (body && typeof body === 'object' && 'data' in body) {
        response.status(exception.getStatus()).json(body);
        return;
      }
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR',
          message: status === 404 ? 'Not found.' : 'Request failed.',
        },
      });
      return;
    }
    const code =
      exception && typeof exception === 'object' && 'code' in exception
        ? String((exception as { code: unknown }).code)
        : '';
    if (code === 'LIMIT_FILE_SIZE') {
      response.status(422).json({
        error: { code: 'UPLOAD_TOO_LARGE', message: 'That file is larger than 10 MB.' },
      });
      return;
    }
    console.log(
      JSON.stringify({
        level: 'error',
        event: 'unhandled',
        message: exception instanceof Error ? exception.message : 'error',
      }),
    );
    response.status(500).json({
      error: { code: 'INTERNAL', message: 'Something went wrong.' },
    });
  }
}

export function securityLog(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'security', event, time: new Date().toISOString(), ...fields }));
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
