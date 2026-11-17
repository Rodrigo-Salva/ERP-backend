import { AuthenticatedRequest } from '../../../common/auth/authenticated-request';
import type { CatalogContext } from '../services/catalog-core.service';

/** Contexto de una operación del catálogo a partir de la petición. */
export const context = (
  req: AuthenticatedRequest,
  organizationId: string,
): CatalogContext => ({
  userId: req.auth.userId,
  requestId: req.requestId,
  organizationId,
});
