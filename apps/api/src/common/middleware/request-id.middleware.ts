import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';
// A client-supplied id is only ever used for correlation/tracing, never as an
// authorization or idempotency mechanism (see §81 - this is deliberately a
// different concept from an Idempotency-Key) - so accepting one that's
// merely well-formed is safe. Bounded length/charset prevents a client from
// smuggling an oversized or control-character-laden value into structured
// logs downstream.
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,100}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  (req as RequestWithId).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
