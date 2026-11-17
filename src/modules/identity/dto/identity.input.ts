import { z } from 'zod';
import { email, label, password, uuid } from '../../../common/domain/input';
import { PERMISSIONS } from '../../../common/domain/domain.service';
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const forgotSchema = z.object({ email }).strict();
export const resetSchema = z.object({ token, password }).strict();
export const acceptSchema = z.object({ token, password, name: label }).strict();
export const membershipSchema = z
  .object({
    role: z.enum(['ADMIN', 'MANAGER', 'CASHIER', 'VIEWER']),
    allBranches: z.boolean(),
    branchIds: z.array(uuid).max(100),
    permissions: z
      .array(z.enum(PERMISSIONS))
      .max(PERMISSIONS.length)
      .default([]),
    revoked: z.boolean().default(false),
  })
  .strict();
export const inviteSchema = membershipSchema
  .omit({ revoked: true })
  .extend({ email })
  .strict();
export type ResetInput = z.infer<typeof resetSchema>;
export type AcceptInput = z.infer<typeof acceptSchema>;
export type MembershipInput = z.infer<typeof membershipSchema>;
export type InviteInput = z.infer<typeof inviteSchema>;
