import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestWithId } from './request-context.middleware';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Error interno del servidor';

    if (statusCode === 503) {
      message = 'Servicio temporalmente no disponible';
    } else if (statusCode === 404) {
      message = 'Recurso no encontrado';
    } else if (exception instanceof HttpException && statusCode < 500) {
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else if ('message' in body && typeof body.message === 'string')
        message = body.message;
      else if ('message' in body && Array.isArray(body.message)) {
        message = body.message.filter(
          (item): item is string => typeof item === 'string',
        );
      }
    }

    if (statusCode >= 500) {
      this.logger.error({
        event: 'request_failed',
        requestId: request.requestId,
        statusCode,
        // Solo metadatos: los mensajes de la base pueden contener valores sensibles.
        errorType:
          exception instanceof Error
            ? exception.constructor.name
            : typeof exception,
        ...(exception instanceof Error && 'code' in exception
          ? { errorCode: String(exception.code) }
          : {}),
      });
    }
    response.status(statusCode).json({
      statusCode,
      message,
      requestId: request.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
