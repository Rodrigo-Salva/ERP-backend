-- Integridad de las tablas operativas: pertenencia a la organización, importes, estados
-- e inmutabilidad. Estas restricciones no se expresan en schema.prisma; consérvalas al
-- generar nuevas migraciones.

-- Referencias a usuarios y organizaciones.
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DocumentCounter" ADD CONSTRAINT "DocumentCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Catálogos de la organización.
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CashRegister" ADD CONSTRAINT "CashRegister_organizationId_branchId_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Inventario.
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_warehouse_fkey" FOREIGN KEY ("organizationId", "branchId", "warehouseId") REFERENCES "Warehouse"("organizationId", "branchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_variant_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "ProductVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_warehouse_fkey" FOREIGN KEY ("organizationId", "branchId", "warehouseId") REFERENCES "Warehouse"("organizationId", "branchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_variant_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "ProductVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_source_fkey" FOREIGN KEY ("organizationId", "branchId", "sourceWarehouseId") REFERENCES "Warehouse"("organizationId", "branchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_target_fkey" FOREIGN KEY ("organizationId", "targetBranchId", "targetWarehouseId") REFERENCES "Warehouse"("organizationId", "branchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Compras.
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_warehouse_fkey" FOREIGN KEY ("organizationId", "branchId", "warehouseId") REFERENCES "Warehouse"("organizationId", "branchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplier_fkey" FOREIGN KEY ("organizationId", "supplierId") REFERENCES "Supplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_variant_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "ProductVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_order_fkey" FOREIGN KEY ("organizationId", "purchaseOrderId") REFERENCES "PurchaseOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_branch_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Caja, ventas y gastos.
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_register_fkey" FOREIGN KEY ("organizationId", "cashRegisterId") REFERENCES "CashRegister"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_branch_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_closedBy_fkey" FOREIGN KEY ("closedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_session_fkey" FOREIGN KEY ("organizationId", "cashSessionId") REFERENCES "CashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_warehouse_fkey" FOREIGN KEY ("organizationId", "branchId", "warehouseId") REFERENCES "Warehouse"("organizationId", "branchId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_session_fkey" FOREIGN KEY ("organizationId", "cashSessionId") REFERENCES "CashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customer_fkey" FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_variant_fkey" FOREIGN KEY ("organizationId", "variantId") REFERENCES "ProductVariant"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_method_fkey" FOREIGN KEY ("organizationId", "methodId") REFERENCES "PaymentMethod"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_sale_fkey" FOREIGN KEY ("organizationId", "saleId") REFERENCES "Sale"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_session_fkey" FOREIGN KEY ("organizationId", "cashSessionId") REFERENCES "CashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_method_fkey" FOREIGN KEY ("organizationId", "methodId") REFERENCES "PaymentMethod"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_branch_fkey" FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_category_fkey" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "ExpenseCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_session_fkey" FOREIGN KEY ("organizationId", "cashSessionId") REFERENCES "CashSession"("organizationId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Valores válidos. El saldo de inventario puede ser negativo solo si la organización lo
-- permite (allowNegativeStock); esa regla se aplica en el servidor.
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_settings_check"
CHECK ("moneyPrecision" BETWEEN 0 AND 4 AND "taxRate" >= 0 AND "taxRate" <= 100 AND "discountLimit" >= 0 AND "discountLimit" <= 100);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_status_check"
CHECK ("status" IN ('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'));
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_amounts_check"
CHECK ("quantity" > 0 AND "received" >= 0 AND "received" <= "quantity" AND "unitCost" >= 0);
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_status_check"
CHECK ("status" IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'));
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_route_check"
CHECK ("sourceWarehouseId" <> "targetWarehouseId");
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_math_check"
CHECK ("delta" <> 0 AND "after" = "before" + "delta");
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_value_check"
CHECK ("quantity" <> 0 OR "value" = 0);
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_amounts_check"
CHECK ("opening" >= 0 AND ("closedAt" IS NULL) = ("counted" IS NULL) AND ("closedAt" IS NULL) = ("expected" IS NULL) AND ("closedAt" IS NULL) = ("difference" IS NULL) AND ("closedAt" IS NULL) = ("closedBy" IS NULL));
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_amount_check" CHECK ("amount" <> 0);
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_status_check"
CHECK ("status" IN ('DRAFT', 'CONFIRMED', 'CANCELLED', 'PARTIAL_RETURN', 'RETURNED'));
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_amounts_check"
CHECK ("gross" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0 AND "change" >= 0 AND "moneyPrecision" BETWEEN 0 AND 4 AND "taxRate" >= 0 AND ("folio" IS NOT NULL OR "status" IN ('DRAFT', 'CANCELLED')));
ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_amounts_check"
CHECK ("quantity" > 0 AND "returned" >= 0 AND "returned" <= "quantity" AND "price" >= 0 AND "cost" >= 0 AND "discountRate" >= 0 AND "gross" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "SaleReturn" ADD CONSTRAINT "SaleReturn_amounts_check"
CHECK ("gross" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_expiry_check" CHECK ("expiresAt" > "createdAt");
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_expiry_check" CHECK ("expiresAt" > "createdAt");

-- FR-31: una sola sesión de caja abierta por punto de caja.
CREATE UNIQUE INDEX "CashSession_one_open_per_register"
ON "CashSession" ("organizationId", "cashRegisterId") WHERE "closedAt" IS NULL;

-- Una invitación vigente por correo y organización.
CREATE UNIQUE INDEX "Invitation_one_pending_per_email"
ON "Invitation" ("organizationId", "email") WHERE "usedAt" IS NULL AND "revokedAt" IS NULL;

-- Regla 3: los movimientos de inventario y de caja son inmutables.
CREATE FUNCTION erp_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable; registra una operación compensatoria', TG_TABLE_NAME USING ERRCODE = '23000';
END;
$$;
CREATE TRIGGER "InventoryMovement_immutable" BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION erp_reject_change();
CREATE TRIGGER "CashMovement_immutable" BEFORE UPDATE OR DELETE ON "CashMovement"
FOR EACH ROW EXECUTE FUNCTION erp_reject_change();
CREATE TRIGGER "AuditEvent_immutable" BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION erp_reject_change();
CREATE TRIGGER "GoodsReceipt_immutable" BEFORE UPDATE OR DELETE ON "GoodsReceipt"
FOR EACH ROW EXECUTE FUNCTION erp_reject_change();
CREATE TRIGGER "SaleReturn_immutable" BEFORE UPDATE OR DELETE ON "SaleReturn"
FOR EACH ROW EXECUTE FUNCTION erp_reject_change();
CREATE TRIGGER "Payment_immutable" BEFORE UPDATE OR DELETE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION erp_reject_change();

-- FR-33/FR-35: un cierre de caja finalizado no se sobrescribe ni se elimina.
CREATE FUNCTION erp_protect_closed_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."closedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'La sesión de caja cerrada es inmutable' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CashSession_closed_immutable" BEFORE UPDATE OR DELETE ON "CashSession"
FOR EACH ROW EXECUTE FUNCTION erp_protect_closed_session();
