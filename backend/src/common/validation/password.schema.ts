import { z } from 'zod'

/**
 * Password policy — must match the frontend's `password.schema.ts` exactly.
 *
 * OWASP 2024 baseline:
 *   - 12-128 chars
 *   - at least one lowercase
 *   - at least one uppercase
 *   - at least one digit
 *
 * No special-char requirement (counter-productive — users append "!").
 * No max-32 like legacy systems — argon2id handles long passwords fine.
 */
export const passwordSchema = z
  .string()
  .min(12, { message: 'Password must be at least 12 characters.' })
  .max(128, { message: 'Password may be at most 128 characters.' })
  .regex(/[a-z]/, { message: 'Password must contain a lowercase letter.' })
  .regex(/[A-Z]/, { message: 'Password must contain an uppercase letter.' })
  .regex(/[0-9]/, { message: 'Password must contain a digit.' })
