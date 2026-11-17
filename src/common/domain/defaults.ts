import { Prisma } from '../../generated/prisma/client';

// Datos mínimos para operar el primer hito: cobrar en efectivo, registrar gastos y
// abrir caja. La organización puede editarlos o archivarlos después.
export async function provisionOrganizationDefaults(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.paymentMethod.createMany({
    data: [
      { organizationId, code: 'CASH', name: 'Efectivo', isCash: true },
      {
        organizationId,
        code: 'TRANSFER',
        name: 'Transferencia',
        isCash: false,
      },
    ],
  });
  await tx.expenseCategory.create({
    data: { organizationId, name: 'General' },
  });
}

export async function provisionBranchDefaults(
  tx: Prisma.TransactionClient,
  organizationId: string,
  branchId: string,
): Promise<void> {
  await tx.cashRegister.create({
    data: { organizationId, branchId, name: 'Caja 1' },
  });
}
