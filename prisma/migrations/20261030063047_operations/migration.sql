-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discountLimit" DECIMAL(7,4) NOT NULL DEFAULT 0,
ADD COLUMN     "moneyPrecision" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "receiptPrefix" VARCHAR(12) NOT NULL DEFAULT 'V',
ADD COLUMN     "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "archivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "name" VARCHAR(120) NOT NULL DEFAULT 'Principal';

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "Role" NOT NULL,
    "allBranches" BOOLEAN NOT NULL DEFAULT false,
    "branchIds" TEXT[],
    "permissions" TEXT[],
    "tokenHash" CHAR(64) NOT NULL,
    "invitedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "operation" VARCHAR(120) NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "address" VARCHAR(300),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "consentAt" TIMESTAMPTZ(3) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "value" DECIMAL(30,7) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "referenceId" UUID NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "delta" DECIMAL(18,3) NOT NULL,
    "before" DECIMAL(18,3) NOT NULL,
    "after" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(26,7) NOT NULL,
    "valueDelta" DECIMAL(30,7) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "notes" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "received" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransfer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "targetBranchId" UUID NOT NULL,
    "sourceWarehouseId" UUID NOT NULL,
    "targetWarehouseId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(300) NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "InventoryTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "isCash" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashRegister" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CashRegister_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cashRegisterId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "opening" DECIMAL(18,4) NOT NULL,
    "expected" DECIMAL(18,4),
    "counted" DECIMAL(18,4),
    "difference" DECIMAL(18,4),
    "closedBy" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "cashSessionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "kind" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "referenceId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "cashSessionId" UUID NOT NULL,
    "customerId" UUID,
    "actorId" UUID NOT NULL,
    "folio" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "moneyPrecision" INTEGER NOT NULL,
    "taxRate" DECIMAL(7,4) NOT NULL,
    "taxIncluded" BOOLEAN NOT NULL,
    "gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "change" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "storeSnapshot" JSONB NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "returned" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4) NOT NULL,
    "cost" DECIMAL(26,7) NOT NULL DEFAULT 0,
    "discountRate" DECIMAL(7,4) NOT NULL,
    "gross" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL,
    "tax" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "SaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "methodId" UUID NOT NULL,
    "methodName" VARCHAR(80) NOT NULL,
    "isCash" BOOLEAN NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "cashSessionId" UUID,
    "actorId" UUID NOT NULL,
    "methodId" UUID NOT NULL,
    "reason" VARCHAR(300) NOT NULL,
    "lines" JSONB NOT NULL,
    "gross" DECIMAL(18,4) NOT NULL,
    "discount" DECIMAL(18,4) NOT NULL,
    "tax" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "cashSessionId" UUID,
    "amount" DECIMAL(18,4) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCounter" (
    "organizationId" UUID NOT NULL,
    "namespace" VARCHAR(20) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentCounter_pkey" PRIMARY KEY ("organizationId","namespace")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_operation_key_key" ON "IdempotencyRecord"("organizationId", "operation", "key");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_name_idx" ON "Supplier"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_organizationId_id_key" ON "Supplier"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Customer_organizationId_name_idx" ON "Customer"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_organizationId_id_key" ON "Customer"("organizationId", "id");

-- CreateIndex
CREATE INDEX "InventoryBalance_organizationId_branchId_idx" ON "InventoryBalance"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_organizationId_warehouseId_variantId_key" ON "InventoryBalance"("organizationId", "warehouseId", "variantId");

-- CreateIndex
CREATE INDEX "InventoryMovement_organizationId_branchId_createdAt_idx" ON "InventoryMovement"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_organizationId_referenceId_idx" ON "InventoryMovement"("organizationId", "referenceId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_organizationId_branchId_createdAt_idx" ON "PurchaseOrder"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organizationId_id_key" ON "PurchaseOrder"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_organizationId_id_key" ON "PurchaseOrderLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_organizationId_purchaseOrderId_variantId_key" ON "PurchaseOrderLine"("organizationId", "purchaseOrderId", "variantId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_organizationId_branchId_createdAt_idx" ON "GoodsReceipt"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryTransfer_organizationId_branchId_targetBranchId_idx" ON "InventoryTransfer"("organizationId", "branchId", "targetBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTransfer_organizationId_id_key" ON "InventoryTransfer"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_organizationId_id_key" ON "PaymentMethod"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_organizationId_code_key" ON "PaymentMethod"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_organizationId_id_key" ON "ExpenseCategory"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_organizationId_name_key" ON "ExpenseCategory"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_organizationId_id_key" ON "CashRegister"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CashRegister_organizationId_branchId_name_key" ON "CashRegister"("organizationId", "branchId", "name");

-- CreateIndex
CREATE INDEX "CashSession_organizationId_branchId_createdAt_idx" ON "CashSession"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashSession_organizationId_id_key" ON "CashSession"("organizationId", "id");

-- CreateIndex
CREATE INDEX "CashMovement_organizationId_cashSessionId_createdAt_idx" ON "CashMovement"("organizationId", "cashSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Sale_organizationId_branchId_createdAt_idx" ON "Sale"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_organizationId_id_key" ON "Sale"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_organizationId_folio_key" ON "Sale"("organizationId", "folio");

-- CreateIndex
CREATE UNIQUE INDEX "SaleLine_organizationId_id_key" ON "SaleLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SaleLine_organizationId_saleId_variantId_key" ON "SaleLine"("organizationId", "saleId", "variantId");

-- CreateIndex
CREATE INDEX "Payment_organizationId_saleId_idx" ON "Payment"("organizationId", "saleId");

-- CreateIndex
CREATE INDEX "SaleReturn_organizationId_branchId_createdAt_idx" ON "SaleReturn"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "SaleReturn_organizationId_saleId_idx" ON "SaleReturn"("organizationId", "saleId");

-- CreateIndex
CREATE INDEX "Expense_organizationId_branchId_occurredAt_idx" ON "Expense"("organizationId", "branchId", "occurredAt");

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_organizationId_purchaseOrderId_fkey" FOREIGN KEY ("organizationId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_organizationId_saleId_fkey" FOREIGN KEY ("organizationId", "saleId") REFERENCES "Sale"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_saleId_fkey" FOREIGN KEY ("organizationId", "saleId") REFERENCES "Sale"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
