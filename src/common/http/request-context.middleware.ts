import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export interface RequestWithId extends Request {
  requestId: string;
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: RequestWithId, res: Response, next: NextFunction): void {
    // Generado por el servidor: no confiar en identificadores arbitrarios del cliente.
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    const started = performance.now();
    res.once('finish', () => {
      this.logger.log({
        event: 'http_request',
        requestId: req.requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    });
    next();
  }
}
