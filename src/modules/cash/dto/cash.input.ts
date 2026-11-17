import { z } from 'zod';
import { amount, label, reason, uuid } from '../../../common/domain/input';

export const registerSchema = z
  .object({ branchId: uuid, name: label })
  .strict();
export const openCashSchema = z
  .object({ cashRegisterId: uuid, opening: amount })
  .strict();
export const closeCashSchema = z.object({ counted: amount }).strict();
export const cashMovementSchema = z
  .object({ direction: z.enum(['IN', 'OUT']), amount, reason })
  .strict();
export const expenseSchema = z
  .object({
    branchId: uuid,
    categoryId: uuid,
    cashSessionId: uuid.optional(),
    amount,
    description: reason,
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type OpenCashInput = z.infer<typeof openCashSchema>;
export type CloseCashInput = z.infer<typeof closeCashSchema>;
export type CashMovementInput = z.infer<typeof cashMovementSchema>;
export type ExpenseInput = z.infer<typeof expenseSchema>;
