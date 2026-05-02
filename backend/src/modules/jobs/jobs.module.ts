import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { WebhookWorker } from './workers/webhook.worker'
import { UsageWorker } from './workers/usage.worker'
import { EmailWorker } from './workers/email.worker'
import { PrismaService } from '../../prisma/prisma.service'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'
const url = new URL(redisUrl)

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: url.hostname,
        port: parseInt(url.port, 10) || 6379,
      },
    }),
    BullModule.registerQueue(
      { name: 'webhook-deliveries' },
      { name: 'usage-processing' },
      { name: 'email-sending' },
    ),
  ],
  providers: [WebhookWorker, UsageWorker, EmailWorker, PrismaService],
})
export class JobsModule {}
