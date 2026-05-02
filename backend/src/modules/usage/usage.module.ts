import { Module } from '@nestjs/common'
import { UsageController } from './usage.controller'
import { UsageService } from './usage.service'
import { PrismaService } from '../../prisma/prisma.service'

@Module({
  controllers: [UsageController],
  providers: [UsageService, PrismaService],
})
export class UsageModule {}
