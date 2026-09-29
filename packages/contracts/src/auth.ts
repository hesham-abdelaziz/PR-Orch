import { z } from 'zod';

export const UsernameSchema = z.string().trim().min(1).max(64);
export const PasswordSchema = z.string().min(12).max(256);

export const SetupAccountRequestSchema = z.strictObject({
  username: UsernameSchema,
  password: PasswordSchema,
});

export const LoginRequestSchema = SetupAccountRequestSchema;

export const ChangePasswordRequestSchema = z.strictObject({
  currentPassword: PasswordSchema,
  newPassword: PasswordSchema,
});

export const AuthSessionSchema = z.discriminatedUnion('authenticated', [
  z.strictObject({
    authenticated: z.literal(false),
    setupRequired: z.boolean(),
  }),
  z.strictObject({
    authenticated: z.literal(true),
    setupRequired: z.literal(false),
    username: UsernameSchema,
    expiresAt: z.string().datetime(),
  }),
]);

export type SetupAccountRequest = z.infer<typeof SetupAccountRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type ChangePasswordRequest = z.infer<
  typeof ChangePasswordRequestSchema
>;
export type AuthSession = z.infer<typeof AuthSessionSchema>;
