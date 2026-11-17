BEGIN;

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "changes" JSONB;

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameKey" VARCHAR(240) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "categoryId" UUID,
    "unitId" UUID NOT NULL,
    "lowStockThreshold" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "sku" VARCHAR(64) NOT NULL,
    "barcode" VARCHAR(64),
    "cost" DECIMAL(18,4) NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_id_key" ON "Category"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_nameKey_key" ON "Category"("organizationId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_organizationId_id_key" ON "UnitOfMeasure"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_organizationId_code_key" ON "UnitOfMeasure"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Product_organizationId_archivedAt_name_idx" ON "Product"("organizationId", "archivedAt", "name");

-- CreateIndex
CREATE INDEX "Product_organizationId_categoryId_idx" ON "Product"("organizationId", "categoryId");

-- CreateIndex
CREATE INDEX "Product_organizationId_unitId_idx" ON "Product"("organizationId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_organizationId_id_key" ON "Product"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ProductVariant_organizationId_productId_idx" ON "ProductVariant"("organizationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_organizationId_id_key" ON "ProductVariant"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_organizationId_sku_key" ON "ProductVariant"("organizationId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_organizationId_barcode_key" ON "ProductVariant"("organizationId", "barcode");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_categoryId_fkey" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "Category"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_unitId_fkey" FOREIGN KEY ("organizationId", "unitId") REFERENCES "UnitOfMeasure"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Reglas de integridad adicionales que deben conservarse en futuras migraciones.
CREATE UNIQUE INDEX "ProductVariant_one_default_per_product"
ON "ProductVariant" ("organizationId", "productId") WHERE "isDefault" = true;

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_nonnegative_amounts"
CHECK ("cost" >= 0 AND "price" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_normalized_sku"
CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$');
ALTER TABLE "Product" ADD CONSTRAINT "Product_nonnegative_threshold"
CHECK ("lowStockThreshold" >= 0);
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_precision_range"
CHECK ("precision" BETWEEN 0 AND 3);
ALTER TABLE "UnitOfMeasure" ADD CONSTRAINT "UnitOfMeasure_normalized_code"
CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');

COMMIT;
