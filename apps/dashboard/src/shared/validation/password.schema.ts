import { z } from 'zod'

/**
 * Password policy — must match the backend `password.schema.ts` exactly.
 *
 * Rules (OWASP 2024 baseline):
 *   - 12-128 chars
 *   - at least one lowercase
 *   - at least one uppercase
 *   - at least one digit
 *
 * No special-char requirement (proven counter-productive — users append `!`).
 * No max-32 like legacy systems — modern argon2id handles long passwords fine.
 *
 * UX rule: surface ALL violated requirements at once via a checklist component,
 * not as a single "password too weak" message.
 */
export const passwordSchema = z
  .string()
  .min(12, { message: 'Hasło musi mieć co najmniej 12 znaków.' })
  .max(128, { message: 'Hasło może mieć najwyżej 128 znaków.' })
  .regex(/[a-z]/, { message: 'Hasło musi zawierać małą literę.' })
  .regex(/[A-Z]/, { message: 'Hasło musi zawierać wielką literę.' })
  .regex(/[0-9]/, { message: 'Hasło musi zawierać cyfrę.' })

/**
 * Helper for password-confirm fields. Use with `.refine()` on the parent schema:
 *
 *   z.object({
 *     password: passwordSchema,
 *     confirmPassword: z.string(),
 *   }).refine(matchesPassword, {
 *     message: 'Hasła nie są zgodne.',
 *     path: ['confirmPassword'],
 *   })
 */
export const matchesPassword = (data: { password: string; confirmPassword: string }) =>
  data.password === data.confirmPassword
