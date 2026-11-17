# Seguimiento del backend

- [x] Base, acceso inicial y catálogo simple.
- [x] Usuarios, invitaciones, recuperación y correo local.
- [x] Configuración, sucursales, almacenes y variantes.
- [x] Inventario, ajustes, proveedores, compras, recepciones y transferencias.
- [x] Clientes, caja, ventas, pagos, recibos y devoluciones.
- [x] Gastos, auditoría, reportes y CSV.
- [x] Pruebas de flujos completos, concurrencia, idempotencia y aislamiento.
- [x] Documentación y comandos reproducibles de demostración y respaldo.
- [ ] Mejoras opcionales (recepción parcial de transferencias, impuesto por producto, descuento sobre el total): ver README, «Mejoras opcionales para más adelante».
- [x] Frontend (proyecto aparte, ver `../frontend`): consume la API mediante un BFF; recorrido E2E aprobado contra este backend.
- [ ] Proxies de confianza (`trust proxy`) para que los límites de peticiones usen la IP real del cliente cuando hay un BFF delante.
- [ ] Integración continua, cuando el repositorio esté alojado.
- [x] Base local `erp_dev`: rol `erp` y bases creados, migraciones aplicadas, pruebas de integración y datos de demostración verificados en PostgreSQL local.
- [ ] Despliegue, proveedor de correo SMTP, respaldos automáticos en producción y rendimiento medido.

Desarrollo sin Docker; los contenedores quedan para producción.

## Decisiones de implementación

- **Valoración:** promedio ponderado móvil por almacén y variante; valor con 7 decimales y cantidades con 3. La salida usa el promedio vigente como costo histórico de la venta.
- **Importes:** `NUMERIC(18,4)` exacto; la API los recibe y devuelve como texto. La precisión monetaria (0–4) es de cada organización.
- **Impuestos y descuentos:** descuento antes de impuesto; tasa única configurable por organización, incluida o agregada; redondeo `HALF_UP` por línea.
- **Devoluciones:** diferencias de acumulados para devolver exactamente lo cobrado al completarse; `restock` explícito por línea (artículos dañados no vuelven al inventario). Requieren el permiso `sales.return`.
- **Anulaciones:** un borrador se descarta sin permiso; una venta confirmada se anula con `sales.cancel` mediante una devolución completa.
- **Stock negativo:** deshabilitado por omisión; exige configuración de la organización y el permiso `inventory.negative`.
- **Caja:** una sesión abierta por punto; esperado = fondo + cobros en efectivo − cambio − reembolsos en efectivo − gastos de caja ± movimientos manuales. Cierres inmutables.
- **Descuentos:** hasta `discountLimit` libres; por encima requieren `sales.discount`.
- **Transferencias:** al enviar se descuenta el origen; en tránsito no cuentan en ningún almacén; al recibir se suma el destino con el costo de salida; cancelar en tránsito reintegra al origen. La recepción es total (no hay recepciones parciales ni diferencias).
- **Acceso:** sesiones opacas (hash SHA-256), Argon2id, invitaciones de 48 h y recuperación de 30 min, ambas de un solo uso y con correo local en desarrollo.
- **Idempotencia:** clave por organización, operación y usuario, con huella canónica del cuerpo; el resultado previo se devuelve con la redacción de costos que corresponda al solicitante.
- **Integridad en PostgreSQL:** claves foráneas compuestas por organización, `CHECK`, índices parciales y triggers de inmutabilidad (migración `integrity`).

## Contrato pensado para el cliente

- Las consultas de saldos, movimientos, compras, transferencias y reportes de inventario/movimientos devuelven nombres legibles (`sku`, `name`, `warehouseName`, `supplierName`) resueltos con una consulta por página, para no obligar al cliente a cruzar identificadores.
- `/me` y la lista de miembros incluyen los permisos explícitos; la lista de miembros incluye también las sucursales asignadas.
