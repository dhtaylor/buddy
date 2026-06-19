import type { FastifyReply } from 'fastify';

/**
 * Standard API error helper. Every error response is shaped:
 *   { error: { code, message } }
 * with a non-2xx HTTP status. Successful responses are { data: T }.
 */
export class ApiException extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new ApiException(400, code, message);
export const unauthorized = (message = 'Not authenticated', code = 'unauthorized') =>
  new ApiException(401, code, message);
export const forbidden = (message = 'Forbidden', code = 'forbidden') =>
  new ApiException(403, code, message);
export const notFound = (message = 'Not found', code = 'not_found') =>
  new ApiException(404, code, message);
export const conflict = (message: string, code = 'conflict') =>
  new ApiException(409, code, message);

export function sendError(reply: FastifyReply, err: ApiException) {
  return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
}
