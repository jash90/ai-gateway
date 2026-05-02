import { Module } from '@nestjs/common'
import { EmailsService } from './emails.service'
import { ConfigModule } from '@nestjs/config'
import { BullModule } from '@nestjs/bullmq'

@Module({
  imports: [
    ConfigModule,
    BullModule.registerQueue({ name: 'email-sending' }),
  ],
  providers: [EmailsService],
  exports: [EmailsService],
})
export class EmailsModule {}
