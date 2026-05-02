import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AdminService } from './admin.service'
import {
  AdminAccountListResponseDto,
  AdminListAccountsQueryDto,
} from './dto/admin-accounts.dto'

@ApiTags('admin')
@ApiBearerAuth('bearer')
@ApiSecurity('admin-key')
@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('accounts')
  @ZodResponse({
    status: 200,
    description: 'All accounts with summary metrics.',
    type: AdminAccountListResponseDto,
  })
  @ApiOperation({
    summary: 'List all accounts',
    description:
      'Multi-tenant view: every Account in the system, with applications, keys, and 30-day cost.',
  })
  async listAccounts(@Query() query: AdminListAccountsQueryDto) {
    return this.admin.listAccounts({
      search: query.search,
      role: query.role,
      includeDeleted: query.includeDeleted === 'true',
    })
  }
}
