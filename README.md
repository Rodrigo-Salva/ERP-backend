# Backend del ERP

API con NestJS, TypeScript estricto y PostgreSQL mediante Prisma. La especificación está en [ERP-SPEC.md](../docs/ERP-SPEC.md).

Código, dependencias, configuración, variables de entorno, migraciones, pruebas y documentación del servidor viven dentro de `backend/`. **El desarrollo usa Node.js y PostgreSQL locales, sin Docker.** Los contenedores quedan para producción.

## Estado actual

El backend implementa todo el alcance de la primera versión definido en [ERP-SPEC.md](../docs/ERP-SPEC.md) (FR-01 a FR-43): acceso, organizaciones, catálogo con variantes, inventario, compras, ventas, caja, gastos, reportes y auditoría. El frontend es un proyecto aparte, en [../frontend](../frontend/README.md), que consume esta API a través de un BFF.

```text
backend/
  config/             # Nest, Prisma, Jest, ESLint y compilación
  docs/               # Seguimiento y decisiones del backend
  prisma/             # Esquema y migraciones de PostgreSQL
  scripts/            # Respaldo, restauración y verificación
  src/                # Código de la API (modules/, common/, cli/)
  test/               # Pruebas unitarias e integración
  .env                # Credenciales locales; no se versiona
  .env.example        # Plantilla de configuración
  package.json        # Dependencias y comandos
  README.md
```

### Estructura de un módulo

```text
src/modules/<módulo>/
  controllers/   # Rutas HTTP: validan la entrada (InputPipe) y delegan en los servicios
  services/      # Lógica de negocio; un servicio por tema (sin archivos de cientos de líneas)
  dto/           # *.input.ts (esquemas Zod y tipos) y *.response.ts (clases solo para Swagger)
  domain/        # Reglas puras sin dependencias de Nest (si las hay, p. ej. cálculos de ventas)
  <módulo>.module.ts
```

Lo transversal vive en `src/common/`: `auth/` (decorador `@Public`, sesión autenticada), `domain/` (autorización, transacciones, idempotencia, auditoría, utilidades de entrada y de fechas) y `http/` (filtro de errores e identificador de petición).

`node_modules/`, `dist/`, `backups/`, `.local-mail/` y `src/generated/prisma/` se generan y no se versionan. Usa los comandos `npm run ...` documentados: ya indican dónde están las configuraciones agrupadas en `config/`.

Principios que aplican a todos los módulos:

- **Autorización en servidor.** Cada endpoint valida sesión, membresía activa, organización, rol, permiso explícito y alcance de sucursal. El cuerpo nunca define organización, rol, precio ni total.
- **Aislamiento.** Claves foráneas compuestas por organización impiden referencias cruzadas; las consultas filtran por organización y sucursales autorizadas.
- **Atomicidad.** Cada operación (venta, recepción, devolución, cierre…) y su auditoría ocurren en una transacción `SERIALIZABLE`; los conflictos concurrentes se reintentan hasta 3 veces y responden 409 si persisten.
- **Idempotencia.** Las operaciones susceptibles a reintentos exigen la cabecera `Idempotency-Key` (8–100 caracteres: letras, números, `.`, `_`, `:`, `-`). Un reintento equivalente devuelve el resultado original; la misma clave con otro contenido o usuario responde 409.
- **Inmutabilidad.** Movimientos de inventario y de caja, recepciones, devoluciones, pagos, cierres de caja y auditoría no pueden modificarse ni borrarse (triggers en PostgreSQL). Las correcciones son operaciones compensatorias.
- **Costos ocultos.** Cajeros y usuarios de solo lectura nunca reciben costos ni valoración, ni en respuestas ni en reintentos idempotentes.

## Requisitos

- Node.js 24.11.0 (`.nvmrc`) y npm 11.
- PostgreSQL 17 instalado y en ejecución localmente.
- Una base `erp_dev` y otra `erp_test` para integración.

Todos los comandos siguientes se ejecutan desde `backend/`.

## Configurar PostgreSQL local

Usa pgAdmin o `psql` con tu cuenta administradora local para crear un rol y las bases. Por ejemplo, en `psql`:

```sql
CREATE ROLE erp LOGIN;
\password erp
CREATE DATABASE erp_dev OWNER erp;
CREATE DATABASE erp_test OWNER erp;
```

`\password` solicita la contraseña sin escribirla en el historial. Si el rol o las bases ya existen, utiliza los existentes y ajusta la configuración; no hace falta recrearlos.

Solo si todavía no tienes `.env`, copia el ejemplo:

```powershell
Copy-Item .env.example .env
```

Configura `DATABASE_URL` con tu usuario, contraseña, host, puerto y base de desarrollo; `TEST_DATABASE_URL` debe apuntar a la base de pruebas. Ambos archivos están dentro de `backend/`. Los valores del ejemplo no crean el usuario ni las bases. Codifica los caracteres especiales de la contraseña al incluirla en una URL. `.env` no se versiona.

## Instalar y ejecutar

```powershell
npm ci
npm run prisma:generate
npm run db:deploy
npm run start:dev
```

| URL | Función |
|---|---|
| `http://localhost:3000/api/v1/health/live` | Comprueba que el proceso responde. |
| `http://localhost:3000/api/v1/health` | Ejecuta `SELECT 1` en PostgreSQL; devuelve 503 si falla. |
| `http://localhost:3000/api/docs` | Swagger, si `SWAGGER_ENABLED=true`. |
| `http://localhost:3000/api/docs-json` | Contrato OpenAPI. |

La salud comprueba conexión; `npm run db:status` verifica migraciones. La primera migración crea estructura, sin usuarios ni organizaciones de demostración. Moneda, idioma y zona horaria serán datos explícitos de cada organización.

`HOST` define la interfaz de escucha (por defecto `127.0.0.1`), `PORT` el puerto HTTP y `CORS_ORIGINS` una lista de orígenes separados por comas, sin rutas ni comodines. `NODE_ENV` admite `development`, `test` o `production`. Swagger queda deshabilitado si no se configura.

Los errores contienen `statusCode`, `message`, `requestId` y `timestamp`. Las peticiones reciben `X-Request-Id` generado por el servidor. Los logs registran método, estado y duración; omiten cuerpos, cabeceras y URLs que puedan contener información sensible.

## Acceso y organizaciones

Todos los endpoints usan el prefijo `/api/v1`. El registro público crea una nueva organización con su propietario; no permite unirse a una organización existente ni elegir privilegios mediante el cuerpo de la petición.

| Método y ruta | Comportamiento |
|---|---|
| `POST /auth/register` | Crea tienda y propietario; responde 201 con la sesión. |
| `POST /auth/login` | Valida correo y contraseña; responde 200 con la sesión. |
| `POST /auth/refresh` | Rota el token, invalida el anterior y conserva el vencimiento. |
| `POST /auth/logout` | Revoca la sesión actual; responde 204. |
| `GET /me` | Perfil y membresías activas del usuario, con su rol y sus permisos explícitos (para que el cliente oculte lo que no puede hacer; el servidor igualmente autoriza cada llamada). |
| `GET /organizations/:organizationId/branches` | Solo las sucursales autorizadas. |
| `GET /organizations/:organizationId/members` | Miembros activos con rol, permisos y sucursales asignadas; solo propietario/administrador. |
| `POST /organizations` | Crea otra tienda del usuario autenticado. |

Ejemplo del cuerpo de registro (usa una contraseña propia):

```json
{
  "email": "admin@example.com",
  "password": "reemplaza-esta-clave-local",
  "name": "Administrador",
  "organizationName": "Mi tienda",
  "branchName": "Principal",
  "currency": "PEN",
  "locale": "es-PE",
  "timeZone": "America/Lima"
}
```

Los valores de país/moneda son ejemplos, no configuraciones asumidas. El correo se normaliza a minúsculas. La contraseña debe tener entre 12 y 128 caracteres; se almacena con Argon2id. Login solo recibe `email` y `password`.

Registro y login devuelven `accessToken`, `tokenType: "Bearer"` y `expiresAt`. Envía el token en `Authorization: Bearer <accessToken>` para las rutas protegidas. Son sesiones opacas almacenadas en PostgreSQL: la base guarda únicamente el hash SHA-256 del token. Su duración es `SESSION_TTL_HOURS` (8 por defecto, configurable entre 1 y 24). Refresh rota el token sin prolongar el vencimiento original; dos renovaciones simultáneas no pueden reutilizar la misma sesión.

El backend no usa cookies ni JWT: espera siempre `Authorization: Bearer`. El frontend (Next.js, ver `../frontend/README.md`) actúa como BFF: guarda el token en una cookie `httpOnly` en su propio servidor y llama a esta API desde allí, por lo que el navegador nunca lo ve ni se necesita CORS. Un cliente que no sea el BFF no debe guardar el token en `localStorage`. La API rechaza las sesiones vencidas, revocadas o de usuarios deshabilitados. No guarda contraseñas, tokens ni cabeceras de autorización en auditoría o logs, y responde con `Cache-Control: no-store`.

Las consultas de sucursales y miembros aceptan `page` (desde 1) y `limit` (1–100; 20 por defecto). Sin membresía válida se responde 404; un rol sin permisos recibe 403. Registro, login y logout generan auditoría transaccional. El registro también crea los valores iniciales para operar: métodos de pago `CASH` (efectivo) y `TRANSFER`, categoría de gasto «General» y la «Caja 1» de la sucursal.

Registro admite 5 solicitudes por minuto e IP; login, refresh y logout admiten 10 cada uno; recuperación de contraseña, restablecimiento y aceptación de invitación admiten 5 cada uno. El limitador actual vive en la memoria de una sola instancia. Antes de desplegar varias réplicas se deberá compartir ese estado y configurar los proxies de confianza. Referencias de implementación: [Argon2](https://github.com/ranisalt/node-argon2) y [limitación de solicitudes de NestJS](https://docs.nestjs.com/security/rate-limiting).

## Usuarios, invitaciones y recuperación

| Método y ruta | Comportamiento |
|---|---|
| `POST /auth/forgot-password` | Responde siempre 202 con el mismo mensaje; no revela si la cuenta existe. Enlace de un solo uso, vigente 30 minutos. |
| `POST /auth/reset-password` | Cambia la contraseña con `token` y `password`; revoca todas las sesiones. |
| `POST /organizations/:id/invitations` | Invita por correo con rol, permisos y sucursales (vigencia 48 h). Solo propietario/administrador. Una invitación nueva reemplaza la pendiente del mismo correo. |
| `GET /organizations/:id/invitations` | Lista invitaciones sin tokens. |
| `POST /organizations/:id/invitations/:id/revoke` | Revoca una invitación pendiente. |
| `POST /auth/accept-invitation` | Crea la cuenta (o vincula una existente con su contraseña) y la membresía. |
| `PATCH /organizations/:id/members/:id` | Cambia rol, permisos, sucursales o revoca. No se puede alterar al propietario ni la propia membresía. |

Los tokens se guardan como hash SHA-256 y viajan en el fragmento (`#token=`) del enlace, de modo que no aparecen en logs de servidor. En desarrollo (`MAIL_TRANSPORT=local`) los mensajes se escriben en `backend/.local-mail/*.eml`; con `MAIL_TRANSPORT=smtp` se usan las variables `SMTP_*`. En producción el transporte local se rechaza.

Roles: `OWNER`, `ADMIN`, `MANAGER` (encargado), `CASHIER` (cajero) y `VIEWER` (solo lectura). Los permisos explícitos, asignables por membresía, son `inventory.adjust`, `inventory.negative`, `sales.discount`, `sales.return`, `sales.cancel` y `cash.adjust`; propietario y administrador los tienen siempre.

## Configuración de la organización

Todas las rutas siguientes llevan el prefijo `/api/v1/organizations/:organizationId`. Las de escritura requieren propietario o administrador (variantes: también encargado).

| Método y ruta | Uso |
|---|---|
| `GET`/`PATCH /settings` | Moneda, idioma, zona horaria, `moneyPrecision` (0–4), `taxRate` (%), `taxIncluded`, `discountLimit` (%), `allowNegativeStock` y `receiptPrefix` (folios). |
| `POST /branches`, `PATCH /branches/:id` | Sucursales; al crear una se generan su almacén «Principal» y «Caja 1». |
| `GET`/`POST /warehouses` | Almacenes por sucursal. |
| `GET`/`POST /payment-methods`, `PATCH …/:id` | Métodos de pago; `isCash` determina si afecta el efectivo esperado. No se almacenan datos de tarjeta. |
| `GET`/`POST /expense-categories`, `PATCH …/:id` | Categorías de gasto. |
| `GET /variants?q=`, `GET`/`POST /products/:id/variants`, `PATCH …/:variantId` | Variantes con SKU, código de barras, precio y costo propios; `q` busca por SKU, código o nombre (también sirve para lectores que se comportan como teclado). |

## Catálogo

El catálogo es compartido por la organización. `OWNER`, `ADMIN` y `MANAGER` pueden crear, editar, archivar, restaurar y ver costos. `CASHIER` y `VIEWER` solo consultan; sus respuestas omiten el campo `cost`, tanto en listados como en detalle. El alcance de sucursal se aplica a saldos, movimientos y documentos.

Las rutas siguientes tienen el prefijo `/api/v1/organizations/:organizationId` y requieren `Authorization: Bearer <accessToken>`. El identificador en la URL siempre se valida contra la membresía; el cuerpo no admite `organizationId` ni roles.

| Método y ruta | Uso |
|---|---|
| `GET /categories`, `GET /units`, `GET /products` | Listar y buscar con paginación. |
| `POST /categories` | Crear categoría con `name`. |
| `POST /units` | Crear unidad con `code`, `name` y `precision` opcional (0–3; defecto 0). |
| `POST /products` | Crear producto y variante predeterminada en una transacción. |
| `GET /products/:id` | Consultar un producto, incluso archivado. |
| `PATCH /categories/:id`, `PATCH /units/:id`, `PATCH /products/:id` | Editar campos permitidos de registros activos. |
| `POST /categories/:id/archive`, `POST /units/:id/archive`, `POST /products/:id/archive` | Archivar conservando los registros. |
| `POST /categories/:id/restore`, `POST /units/:id/restore`, `POST /products/:id/restore` | Restaurar. |

Primero crea una unidad, por ejemplo `{"code":"UND","name":"Unidad","precision":0}`, y opcionalmente una categoría. Luego crea un producto:

```json
{
  "name": "Agua 500 ml",
  "sku": "AGUA-500",
  "barcode": "0001234567890",
  "unitId": "UUID-DE-LA-UNIDAD",
  "categoryId": "UUID-DE-LA-CATEGORIA",
  "description": "Botella individual",
  "cost": "1.2500",
  "price": "2.5000",
  "lowStockThreshold": "5"
}
```

Sustituye los UUID por los devueltos al crear la unidad y categoría. `categoryId`, `description` y `barcode` son opcionales y admiten `null` para borrarlos en una edición. Un PATCH vacío se rechaza; los campos obligatorios no admiten `null`.

- Los importes se envían como **cadenas decimales**, nunca números JSON: hasta 14 dígitos enteros y 4 decimales, sin negativos ni notación exponencial. Se almacenan en `NUMERIC(18,4)` y se devuelven con 4 decimales. El costo es el costo base del catálogo; la valoración y el costo histórico de inventario se definirán en su módulo.
- El umbral también es texto decimal (`NUMERIC(18,3)`). Debe respetar la precisión de su unidad: 0 para unidades indivisibles o hasta 3 para cantidades fraccionarias. Crear un producto no crea existencias.
- SKU y código de unidad se normalizan a mayúsculas. SKU admite letras ASCII, números, puntos, guiones y guiones bajos, hasta 64 caracteres. El código de unidad admite letras ASCII, números, guiones y guiones bajos, hasta 20 caracteres. Los códigos de barras conservan los ceros iniciales.
- SKU y código de barras son únicos por organización; las categorías tienen nombres únicos sin distinguir mayúsculas. Los identificadores siguen reservados después del archivado. Un producto tiene una variante predeterminada, que es la referencia del inventario; se pueden añadir más variantes con SKU, código y precio propios (ver «Configuración de la organización»).
- La unidad del producto no cambia después de crearlo. La precisión de una unidad tampoco cambia una vez usada por algún producto, incluso archivado.
- No se archivan categorías o unidades con productos activos. Para restaurar un producto, su categoría —si existe— y unidad deben estar activas. No hay endpoints de borrado físico.
- Las escrituras y su auditoría de valores anteriores/nuevos son atómicas. Las transacciones serializables reintentan conflictos concurrentes hasta 3 veces y responden 409 si persiste el conflicto. Los duplicados también devuelven 409; referencias ajenas o inexistentes, 404.

Los listados aceptan `q`, `status=active|archived|all`, `page` y `limit` (máximo 100). Por defecto solo muestran activos. Productos también admite `categoryId`; `q` busca nombre, SKU o código de barras. Responden `{ "items": [...], "page": 1, "limit": 20 }`.

## Inventario

Rutas bajo `/api/v1/organizations/:organizationId/inventory`. Las existencias siempre pertenecen a una **variante** y a un **almacén**.

| Método y ruta | Uso |
|---|---|
| `GET /balances`, `GET /movements` | Saldos y movimientos (filtros `branchId`, `from`, `to`, paginación), con `sku`, `name` y `warehouseName` ya resueltos. Sin costos para cajero/solo lectura. |
| `GET /low-stock?warehouseId=` | Variantes en o bajo su umbral, incluso sin saldo. |
| `POST /adjustments` | Ajuste con motivo (`delta` con signo); requiere el permiso `inventory.adjust`. `Idempotency-Key`. |
| `GET`/`POST /transfers` | Transferencias entre almacenes de la misma o distinta sucursal (nacen en borrador). El listado incluye nombres de almacenes y artículos. |
| `POST /transfers/:id/send` · `/receive` · `/cancel` | Borrador → en tránsito (descuenta el origen) → recibida (suma al destino). Cancelar en tránsito reintegra al origen. `Idempotency-Key`. |

Reglas: no se permite inventario negativo salvo que la organización lo habilite (`allowNegativeStock`) **y** el usuario tenga `inventory.negative`. Los movimientos guardan cantidad anterior/nueva, actor, motivo, referencia y costo.

**Valoración:** promedio ponderado móvil por almacén y variante. El valor se guarda con 7 decimales y las cantidades con 3. Una entrada recalcula el promedio con su costo; las salidas usan el promedio vigente, que queda como costo histórico en la línea de venta. Cuando el saldo llega a cero, el valor residual se elimina.

## Proveedores y compras

Rutas bajo `/api/v1/organizations/:organizationId`. Gestión: propietario, administrador y encargado.

| Método y ruta | Uso |
|---|---|
| `GET`/`POST /suppliers`, `PATCH /suppliers/:id` | Proveedores (archivado con `archived`). |
| `POST /purchase-orders`, `GET /purchase-orders`, `GET …/:id` | Órdenes con almacén, proveedor y líneas (cantidad y costo esperado). Las consultas devuelven además `supplierName`, `warehouseName` y, por línea, `sku` y `name`. |
| `POST …/:id/send` · `/cancel` | `DRAFT → SENT`; cancelar solo sin recepciones. |
| `POST …/:id/receipts`, `GET …/:id/receipts` | Recepción total o parcial con costo real por línea. Aumenta existencias una sola vez (`Idempotency-Key`). Estados: `DRAFT`, `SENT`, `PARTIAL`, `RECEIVED`, `CANCELLED`. |

El costo de cada recepción queda en `GoodsReceipt.lines`; cambiar después el costo del catálogo no altera compras registradas.

## Clientes, caja y ventas

Rutas bajo `/api/v1/organizations/:organizationId`.

| Método y ruta | Uso |
|---|---|
| `GET`/`POST /customers`, `PATCH /customers/:id` | Clientes opcionales; el alta exige `consent: true` y registra la fecha. |
| `GET`/`POST /cash-registers` | Puntos de caja (alta: administrador). |
| `POST /cash-sessions` | Abre caja con fondo inicial. Una sola sesión abierta por punto (índice único parcial). |
| `GET /cash-sessions`, `GET …/:id` | Sesiones y movimientos; el cajero solo ve las suyas. |
| `POST …/:id/movements` | Entrada/salida manual con motivo; requiere `cash.adjust`. |
| `POST …/:id/close` | Cierra con `counted`; guarda esperado, contado y diferencia, inmutables. |
| `POST /sales` | Crea un borrador; el servidor fija precio, impuesto y totales. |
| `POST /sales/:id/confirm` | Confirma con uno o más `payments`, descuenta stock, asigna folio y registra el efectivo en una sola transacción. |
| `GET /sales`, `GET /sales/:id` | Filtros `q` (folio), `from`, `to`, `customerId`, `actorId`, `branchId`, `status`. |
| `GET /sales/:id/receipt?format=html` | Recibo imprimible con desglose (JSON por omisión); no es comprobante fiscal. |
| `POST /sales/:id/returns` | Devolución parcial o total; cada línea indica `restock` (reintegra o no, p. ej. artículo dañado). Requiere `sales.return`. |
| `POST /sales/:id/cancel` | Descarta un borrador (sin permiso especial) o anula una venta confirmada devolviéndola completa (`sales.cancel`). |
| `GET`/`POST /expenses` | Gastos; si se pagan desde caja generan una única salida de efectivo (`cash.adjust`). |

Cálculo (ejemplos ejecutables en `test/calculations.spec.ts`): el descuento se aplica **antes** del impuesto; el impuesto, configurable por organización, puede estar **incluido** en el precio o **agregado**; el redondeo es `HALF_UP` por línea con la precisión monetaria de la organización. Las devoluciones parciales usan diferencias de acumulados para que, al completarse, sumen exactamente lo cobrado.

Efectivo esperado = fondo inicial + cobros en efectivo − cambio entregado − reembolsos en efectivo − gastos de caja ± movimientos manuales. Las transferencias y otros medios no lo modifican. Una venta solo se confirma con una sesión abierta de la misma sucursal; el cajero solo opera sus propias cajas. Cierre y confirmación son mutuamente serializables. Los descuentos sobre `discountLimit` exigen `sales.discount`.

Cada línea de venta guarda SKU, nombre, precio, costo e impuestos aplicados; editar el catálogo no cambia ventas pasadas.

## Reportes y auditoría

| Método y ruta | Uso |
|---|---|
| `GET /dashboard` | Ventas del día en la zona horaria de la sucursal, ticket promedio, alertas de stock y cajas abiertas. |
| `GET /reports/:type` y `GET /reports/:type/csv` | `sales`, `inventory`, `movements`, `cash`, `purchases`, `expenses`, con `branchId`, `from`, `to`, paginación y los mismos permisos que la consulta normal. |
| `GET /audit-events` | Auditoría (propietario/administrador con acceso a todas las sucursales); filtro `q` por acción. |

`reports/sales` separa `gross`, `discount`, `salesTotal`, `returnsTotal`, `netTax`, `netTotal` y `netSalesExcludingTax`. El CSV usa UTF-8 con BOM y neutraliza fórmulas de hoja de cálculo sin alterar números negativos. La valoración (`inventory`) solo está disponible para propietario, administrador y encargado.

## Comprobaciones

Después de generar Prisma Client:

```powershell
npm run prisma:validate
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

`npm test` ejecuta las pruebas unitarias y HTTP (PostgreSQL simulado): configuración, contrato HTTP, cálculos de importes/impuestos/devoluciones, CSV y rango del día. `npm run test:integration` usa PostgreSQL real y cubre: acceso y aislamiento entre organizaciones; catálogo; recuperación e invitaciones; variantes, clientes y consulta de ventas; y la operación completa (compra parcial y total, costo promedio, venta con impuestos y pagos mixtos, idempotencia, ventas concurrentes sobre la última unidad, devoluciones, gastos, cierre de caja con diferencia, transferencias, inmutabilidad, costos ocultos, reportes conciliados y auditoría).

Última verificación desde una base vacía: 5 migraciones aplicadas sin deriva respecto de `schema.prisma`, 29 pruebas unitarias/HTTP y 73 de integración aprobadas, además de lint, formato, tipos y build sin errores. Se ejecutó sobre PostgreSQL 17 local, con el rol `erp` (sin permisos de administrador).

Para preparar la base de pruebas y ejecutar integración usando `TEST_DATABASE_URL` de `.env`:

```powershell
npm run db:deploy:test
npm run test:integration
```

El nombre de la base de pruebas debe terminar en `_test`. Las pruebas generan UUID propios y eliminan únicamente sus registros (con un helper que desactiva los triggers de inmutabilidad solo durante esa limpieza). La integración continua no está configurada todavía.

## Datos de demostración

```powershell
$env:SEED_PASSWORD = "elige-una-clave-local"   # 12–128 caracteres; si falta, se genera y se imprime una vez
npm run db:seed
```

Compila y ejecuta `dist/cli/seed-demo.js`, que recorre la API real: crea «Tienda Demo» con propietario, encargado, cajero y usuario de solo lectura (`demo@example.test`, `demo+encargado@example.test`, `demo+cajero@example.test`, `demo+lectura@example.test`), 6 productos con códigos de barras, una compra recibida, ventas (una con pago mixto), una devolución, un gasto, un turno de caja cerrado con diferencia de −0.50, un turno abierto y una transferencia en tránsito hacia una segunda sucursal. No corre con `NODE_ENV=production` y no duplica datos si el usuario ya existe. `SEED_EMAIL` cambia el correo base.

## Respaldo y restauración

Requieren `pg_dump`, `pg_restore` y `psql` en `PATH` (o la variable `PG_BIN`).

```powershell
npm run db:backup                 # backups/erp-<base>-<fecha>.dump (formato custom)
$env:RESTORE_DATABASE_URL = "postgresql://usuario:clave@localhost:5432/erp_restaurada"
npm run db:restore -- backups/erp-erp_dev-20261030T120000Z.dump
npm run db:backup:verify          # respalda, restaura en una base temporal y compara conteos
```

- La contraseña viaja por `PGPASSWORD`, nunca en la línea de comandos. `backups/` no se versiona.
- **Retención:** se conservan las últimas `BACKUP_RETENTION` copias (14 por omisión); `BACKUP_DIR` cambia la carpeta.
- `db:restore` exige un destino explícito y se niega a sobrescribir la base de origen salvo con `CONFIRM_OVERWRITE=yes`.
- `db:backup:verify` necesita permiso `CREATEDB`; compara las filas de las tablas clave y elimina la base temporal. Ejecútalo después de cada cambio de esquema.
- En producción, programa `db:backup` (cron o el planificador del proveedor), copia los archivos fuera del servidor y define RPO/RTO según el proveedor elegido.

## Migraciones

Después de editar `prisma/schema.prisma`:

```powershell
npm run db:migrate -- --name descripcion_del_cambio
npm run prisma:generate
```

`db:migrate` requiere que el rol pueda crear una base temporal de comparación (shadow database) o una URL `SHADOW_DATABASE_URL` dedicada. Si usas esa variable, crea una base vacía separada, por ejemplo `erp_shadow`; Prisma puede reinicializarla, por lo que nunca debe apuntar a desarrollo ni pruebas. `db:deploy` solo aplica migraciones existentes y no requiere esa base temporal. Revisa y versiona el SQL generado.

Las migraciones `catalog` e `integrity` incluyen restricciones SQL que no se expresan en `schema.prisma`: índices parciales (una variante predeterminada por producto, una sesión de caja abierta por punto, una invitación pendiente por correo), `CHECK` de importes, estados y precisión, y triggers de inmutabilidad. Consérvalas al generar nuevas migraciones. Tras editar el esquema, comprueba que no hay deriva con `npx prisma migrate diff --config config/prisma.config.ts --from-config-datasource --to-schema prisma/schema.prisma --exit-code`.

Para ejecutar la compilación: `npm run build` y luego `npm start`. Si falla la conexión, comprueba que PostgreSQL esté iniciado y que `DATABASE_URL` corresponda a un usuario y base existentes.

## Mejoras opcionales para más adelante

No forman parte de la primera versión (FR-01 a FR-43) ni bloquean su uso. Se documentan aquí para retomarlas cuando haya una necesidad real.

### 1. Recepción parcial de transferencias

- **Hoy:** `POST /inventory/transfers/:id/receive` recibe siempre todas las líneas completas. El stock sale del origen al enviar, queda en tránsito y entra al destino al recibir.
- **Qué falta:** recibir menos cantidad que la enviada, registrar la diferencia (faltante o daño) y decidir qué pasa con ella (devolverla al origen, darla de baja o dejarla pendiente). Hoy, si llega menos mercadería, solo se puede cancelar la transferencia en tránsito, y eso reintegra todo al origen.
- **Cómo abordarlo:** que `receive` acepte la cantidad recibida por línea; añadir el estado `PARTIAL` y las cantidades recibidas en `InventoryTransfer.lines`; generar un movimiento compensatorio por la diferencia, con permiso explícito y auditoría. Definir primero la política de diferencias (la spec la deja como decisión pendiente) y probar con más de una sucursal.

### 2. Impuesto distinto por producto

- **Hoy:** cada organización tiene una sola tasa (`taxRate`) y un solo modo (`taxIncluded`), que se aplica a todas las líneas de una venta.
- **Qué falta:** productos con tasa propia, exentos o con varias tasas (por ejemplo, alimentos básicos exentos y el resto gravado).
- **Cómo abordarlo:** añadir la tasa (o una referencia a una tabla de tasas configurables) a la variante o al producto; copiar la tasa aplicada a `SaleLine` como parte del histórico (la línea ya guarda `tax`, pero hoy la tasa vive en `Sale.taxRate`); calcular cada línea con su tasa y desglosar el impuesto por tasa en el recibo y en los reportes (`netTax`). Los ejemplos de `test/calculations.spec.ts` deben ampliarse antes de programarlo, y la regla de redondeo (por línea o por documento) debe validarse con la normativa del país.

### 3. Descuento sobre el total de la venta

- **Hoy:** el descuento es un porcentaje por línea (`discountRate`), se aplica antes del impuesto y, por encima de `discountLimit`, exige el permiso `sales.discount`.
- **Qué falta:** un descuento global (porcentaje o monto) sobre toda la venta, por ejemplo «10 % al total» o «redondear a favor del cliente».
- **Cómo abordarlo:** añadir el descuento a la venta y repartirlo proporcionalmente entre las líneas antes de calcular el impuesto, para que cada línea conserve su histórico y las devoluciones parciales sigan sumando exactamente lo cobrado (`returnPart`). Aplicar el mismo límite y permiso que a los descuentos por línea, y reflejarlo en el recibo y en `reports/sales`.

### Otras ideas descartadas por ahora

- Borradores de venta que reserven stock (hoy el stock se descuenta solo al confirmar).
- Devolución a proveedores y cuentas por pagar.
- Crédito o venta fiada a clientes.
- Conteo físico de inventario como operación propia (hoy se corrige con ajustes manuales).
- Lotes, números de serie y caducidad (la spec los excluye de la primera versión).

## Pendiente antes de producción

- Git e integración continua cuando los repositorios estén alojados.
- Proveedor de despliegue, de correo SMTP y de almacenamiento; contenedor de producción; respaldos automáticos y prueba de restauración en el proveedor elegido.
- País, normativa fiscal, moneda y reglas de impuestos: el recibo es interno y no sustituye un comprobante fiscal. Valida impuestos y redondeo con asesoría local.
- Límite de peticiones compartido entre réplicas y proxies de confianza (el actual vive en la memoria de una instancia).
- Medición de rendimiento (objetivo: p95 < 500 ms con 50 usuarios concurrentes) y pruebas de accesibilidad en el frontend.
- Política de retención y eliminación de datos personales conforme a la ley aplicable.
