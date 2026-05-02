import { z } from 'zod'

/**
 * Canonical email schema for the entire backend.
 *
 * Mirrors the frontend's `apps/dashboard/src/shared/validation/email.schema.ts`.
 * The trim+lowercase normalization MUST happen here (not in the DB), per
 * decision D-008 in the project skill.
 *
 * Use this everywhere a DTO touches email — never define `z.string().email()`
 * inline.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Email is not a valid address.' })
  .max(254, { message: 'Email is too long.' })
