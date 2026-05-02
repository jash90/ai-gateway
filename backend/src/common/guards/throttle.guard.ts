import { Injectable, CanActivate, ExecutionContext, Inject, HttpException } from '@nestjs/common'
import Redis from 'ioredis'

@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(@Inject('REDIS') private redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const customer = request.customer
    if (!customer) return true

    const key = `rate_limit:${customer.id}:${request.routerPath}`
    const limit = this.getLimitForTier(customer.tier)
    const window = 60

    const count = await this.redis.incr(key)
    if (count === 1) {
      await this.redis.expire(key, window)
    }

    request.raw.setHeader('X-RateLimit-Limit', limit)
    request.raw.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count))

    if (count > limit) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded. Please try again later.' },
        429,
      )
    }
    return true
  }

  private getLimitForTier(tier: string): number {
    const limits: Record<string, number> = { free: 30, pro: 300, enterprise: 3000 }
    return limits[tier] ?? 30
  }
}
