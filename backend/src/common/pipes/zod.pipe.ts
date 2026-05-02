import { BadRequestException } from '@nestjs/common'
import { createZodValidationPipe } from 'nestjs-zod'
import { ZodError } from 'zod'

/**
 * Project-wide ZodValidationPipe. Replaces the legacy hand-rolled pipe at
 * `zod-validation.pipe.ts` (deleted alongside this commit).
 *
 * Wired globally as `APP_PIPE` in app.module.ts — every DTO that extends a
 * `createZodDto(schema)` class gets validated automatically. Per-param
 * `@Body(new ZodValidationPipe(schema))` calls are no longer needed.
 *
 * Error shape preserved: `{ errorCode: 'VALIDATION_FAILED', message, errors[] }`.
 * Frontend's customFetch maps this to localized copy.
 */
export const ZodValidationPipe = createZodValidationPipe({
  createValidationException: (err) => {
    const issues =
      err instanceof ZodError
        ? err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          }))
        : []
    return new BadRequestException({
      errorCode: 'VALIDATION_FAILED',
      message: 'Request body failed validation.',
      errors: issues,
    })
  },
})
