import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger'
import { PrismaService } from '../../prisma/prisma.service'
import { Inject } from '@nestjs/common'
import Redis from 'ioredis'
import { Public } from '../../common/decorators/auth.decorator'

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    @Inject('REDIS') private redis: Redis,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check', description: 'Returns system health status including DB and Redis connectivity' })
  @ApiResponse({ status: 200, description: 'Health status' })
  async check() {
    const [db, cache] = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.redis.ping(),
    ])

    return {
      status: db.status === 'fulfilled' && cache.status === 'fulfilled' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: db.status === 'fulfilled' ? 'ok' : 'error',
        redis: cache.status === 'fulfilled' ? 'ok' : 'error',
      },
      uptime: process.uptime(),
    }
  }
}
