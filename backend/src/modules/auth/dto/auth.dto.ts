import { z } from 'zod'
import { createZodDto } from 'nestjs-zod'
import { emailSchema, passwordSchema } from '../../../common/validation'

// =============================================================================
// Request schemas + DTOs
// =============================================================================

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1).max(80).optional(),
})
export class RegisterDto extends createZodDto(registerSchema) {}

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
})
export class LoginDto extends createZodDto(loginSchema) {}

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})
export class RefreshDto extends createZodDto(refreshSchema) {}

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
})
export class LogoutDto extends createZodDto(logoutSchema) {}

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
})
export class VerifyEmailDto extends createZodDto(verifyEmailSchema) {}

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
})
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}

// =============================================================================
// Response schemas + DTOs (drives OpenAPI output schemas → Orval typed hooks)
// =============================================================================

export const accountSummarySchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  name: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN']),
  emailVerified: z.boolean(),
})
export class AccountSummaryDto extends createZodDto(accountSummarySchema) {}

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.number(),
  refreshToken: z.string(),
  refreshExpiresAt: z.number(),
  account: accountSummarySchema,
})
export class LoginResponseDto extends createZodDto(loginResponseSchema) {}

export const registerResponseSchema = z.object({
  accountId: z.string().uuid(),
})
export class RegisterResponseDto extends createZodDto(registerResponseSchema) {}

export const verifyEmailResponseSchema = z.object({
  verified: z.literal(true),
})
export class VerifyEmailResponseDto extends createZodDto(verifyEmailResponseSchema) {}

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  email: emailSchema,
  name: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN']),
  emailVerified: z.boolean(),
  createdAt: z.coerce.date(),
})
export class MeResponseDto extends createZodDto(meResponseSchema) {}

// Legacy plain interfaces kept as type aliases — the AuthService signatures
// still use these inline. The Dto classes above are what wires the pipe + Swagger.
export type AccountSummary = z.infer<typeof accountSummarySchema>
export type LoginResponse = z.infer<typeof loginResponseSchema>
export type RegisterResponse = z.infer<typeof registerResponseSchema>
