import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ZodResponse } from 'nestjs-zod'
import type { Account } from '@prisma/client'
import { ClientAuthGuard } from '../auth/guards/client-auth.guard'
import { CurrentAccount } from '../auth/decorators/current-account.decorator'
import { WalletService } from './wallet.service'
import {
  WalletBalanceDto,
  WalletTransactionListDto,
  ListWalletTransactionsQueryDto,
} from './dto/wallet.dto'

@ApiTags('wallet')
@ApiBearerAuth('bearer')
@Controller('v1/wallet')
@UseGuards(ClientAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'Current token balance.', type: WalletBalanceDto })
  @ApiOperation({ summary: 'Get current wallet balance for the authenticated account' })
  async getBalance(@CurrentAccount() account: Account) {
    const { tokenBalance, refundOnError } = await this.wallet.getBalance(account.id)
    return {
      tokenBalance: tokenBalance.toString(),
      refundOnError,
    }
  }

  @Get('transactions')
  @ZodResponse({
    status: 200,
    description: 'Wallet ledger transactions (paginated, newest first).',
    type: WalletTransactionListDto,
  })
  @ApiOperation({
    summary: 'List wallet transactions for the authenticated account',
    description:
      'Pass `applicationId=<uuid>` to filter to one application\'s ledger, ' +
      '`applicationId=shared` to see only shared-account entries, or omit it to see all.',
  })
  async listTransactions(
    @Query() query: ListWalletTransactionsQueryDto,
    @CurrentAccount() account: Account,
  ) {
    // Translate the query string into the service-level filter:
    //   "shared" → applicationId: null
    //   "<uuid>" → applicationId: "<uuid>"
    //   undefined → no filter (omit the key entirely)
    const applicationFilter: { applicationId?: string | null } =
      query.applicationId === 'shared'
        ? { applicationId: null }
        : query.applicationId
          ? { applicationId: query.applicationId }
          : {}

    const { transactions, total } = await this.wallet.listTransactions(account.id, {
      limit: query.limit,
      cursor: query.cursor,
      type: query.type,
      ...applicationFilter,
    })
    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        balanceAfter: tx.balanceAfter.toString(),
        requestId: tx.requestId,
        stripeEventId: tx.stripeEventId,
        applicationId: tx.applicationId,
        metadata: tx.metadata,
        createdAt: tx.createdAt.toISOString(),
      })),
      total,
    }
  }
}
