import { SetMetadata } from '@nestjs/common';
import { RequestWithId } from '../http/request-context.middleware';

/** Clave de metadatos que marca una ruta como pública (sin sesión). */
export const PUBLIC_ROUTE = 'auth:public';
/** Marca una ruta o controlador como accesible sin sesión (login, registro, salud…). */
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);

/** Sesión autenticada que el guardia adjunta a la petición. */
export interface SessionPrincipal {
  sessionId: string;
  userId: string;
  expiresAt: Date;
}

export interface AuthenticatedRequest extends RequestWithId {
  auth: SessionPrincipal;
}
