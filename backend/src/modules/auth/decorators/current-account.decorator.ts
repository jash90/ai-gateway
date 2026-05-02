import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Account } from '@prisma/client'

/**
 * `@CurrentAccount()` — extracts `request.account` (set by JwtAuthGuard).
 *
 * Use only on routes guarded by JwtAuthGuard, otherwise the value is undefined.
 * Combined with the type narrow below, controllers get a non-nullable Account.
 *
 * Example:
 *
 *   @UseGuards(JwtAuthGuard)
 *   @Get('me')
 *   me(@CurrentAccount() account: Account) {
 *     return { id: account.id, email: account.email }
 *   }
 */
export const CurrentAccount = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Account => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    if (!req.account) {
      throw new Error(
        'CurrentAccount() used on a route without JwtAuthGuard. ' +
          'Add @UseGuards(JwtAuthGuard) above the controller method.',
      )
    }
    return req.account
  },
)
