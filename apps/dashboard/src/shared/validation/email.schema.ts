import { z } from 'zod'

/**
 * Canonical email schema for the entire frontend.
 *
 * Mirrors the backend's `email.schema.ts` in `backend/src/common/validation/`.
 * This is the single source of truth for the rule:
 *
 *   trim → lowercase → RFC 5322 validation → max 254 chars (RFC 5321 SMTP limit)
 *
 * USE THIS in every DTO that touches email — never define a one-off
 * `z.string().email()` inline. See decision D-008 in the project skill.
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Adres email jest nieprawidłowy.' })
  .max(254, { message: 'Adres email jest zbyt długi.' })
