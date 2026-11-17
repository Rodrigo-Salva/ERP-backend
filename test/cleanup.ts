import { PrismaService } from '../src/database/prisma.service';

// Hijos antes que padres. Las tablas con triggers de inmutabilidad solo se
// desprotegen dentro de esta transacción de limpieza de pruebas.
const organizationTables = [
  'SaleReturn',
  'Payment',
  'SaleLine',
  'Expense',
  'CashMovement',
  'Sale',
  'CashSession',
  'CashRegister',
  'GoodsReceipt',
  'PurchaseOrderLine',
  'PurchaseOrder',
  'InventoryTransfer',
  'InventoryMovement',
  'InventoryBalance',
  'IdempotencyRecord',
  'DocumentCounter',
  'Customer',
  'Supplier',
  'PaymentMethod',
  'ExpenseCategory',
  'Invitation',
  'AuditEvent',
  'MembershipBranch',
  'Membership',
  'ProductVariant',
  'Product',
  'Category',
  'UnitOfMeasure',
  'Warehouse',
  'Branch',
];

export async function cleanupTestData(
  prisma: PrismaService,
  organizationIds: string[],
  userIds: string[],
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const table of organizationTables) {
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${table}" DISABLE TRIGGER USER`,
        );
        await tx.$executeRawUnsafe(
          `DELETE FROM "${table}" WHERE "organizationId" = ANY($1::uuid[])`,
          organizationIds,
        );
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${table}" ENABLE TRIGGER USER`,
        );
      }
      await tx.$executeRawUnsafe(
        'DELETE FROM "Organization" WHERE "id" = ANY($1::uuid[])',
        organizationIds,
      );
      await tx.$executeRawUnsafe(
        'DELETE FROM "Session" WHERE "userId" = ANY($1::uuid[])',
        userIds,
      );
      await tx.$executeRawUnsafe(
        'DELETE FROM "PasswordReset" WHERE "userId" = ANY($1::uuid[])',
        userIds,
      );
      await tx.$executeRawUnsafe(
        'DELETE FROM "User" WHERE "id" = ANY($1::uuid[])',
        userIds,
      );
    },
    { timeout: 30000 },
  );
}
