import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger'
import { z } from 'zod'
import { createZodDto, ZodResponse } from 'nestjs-zod'
import { AuditService } from './audit.service'
import { AdminGuard } from '../../common/guards/admin.guard'

const auditLogRowSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid().nullable(),
  actorType: z.enum(['ACCOUNT', 'ADMIN', 'SYSTEM']),
  actorId: z.string().nullable(),
  action: z.string(),
  resource: z.string().nullable(),
  metadata: z.unknown().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.coerce.date(),
})

const auditLogsResponseSchema = z.object({
  logs: z.array(auditLogRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
})
class AuditLogsResponseDto extends createZodDto(auditLogsResponseSchema) {}

@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiSecurity('admin-key')
@Controller('v1/admin/audit-logs')
export class AuditController {
  constructor(private auditService: AuditService) {}

  @Get()
  @UseGuards(AdminGuard)
  @ZodResponse({ status: 200, description: 'Paginated audit logs.', type: AuditLogsResponseDto })
  @ApiOperation({
    summary: 'List audit log entries',
    description:
      'Paginated audit log with filters for accountId, action, and date range. Admin-only.',
  })
  async getLogs(
    @Query('accountId') accountId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditService.getLogs({
      accountId,
      action,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
    })
  }
}
