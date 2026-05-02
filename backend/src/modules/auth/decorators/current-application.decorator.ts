import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Application, ApplicationKey } from '@prisma/client'

/**
 * `@CurrentApplication()` — extracts `request.application` (set by ApplicationKeyGuard).
 * Use only on routes guarded by ApplicationKeyGuard.
 */
export const CurrentApplication = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Application => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    if (!req.application) {
      throw new Error(
        'CurrentApplication() used on a route without ApplicationKeyGuard.',
      )
    }
    return req.application
  },
)

/**
 * `@CurrentApplicationKey()` — extracts the resolved ApplicationKey row.
 * Use to record `applicationKeyId` on UsageEvent.
 */
export const CurrentApplicationKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApplicationKey => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    if (!req.applicationKey) {
      throw new Error(
        'CurrentApplicationKey() used on a route without ApplicationKeyGuard.',
      )
    }
    return req.applicationKey
  },
)
