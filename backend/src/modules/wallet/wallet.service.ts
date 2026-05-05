import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, type WalletTransaction, type WalletTxType } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

/** 402 Payment Required — Nest 11 doesn't ship a PaymentRequiredException. */
export class PaymentRequiredException extends HttpException {
  constructor(payload: { message: string; code: string }) {
    super(payload, HttpStatus.PAYMENT_REQUIRED)
  }
}

/**
 * Wallet — per-application + shared-account token billing.
 *
 * Two wallet sources per Account:
 *   - Account.tokenBalance (SHARED) — drawn from when no app has enough,
 *     OR when user buys a "shared" package.
 *   - Application.tokenBalance (PER_APP) — used first for that app's traffic.
 *
 * Gateway pre-check (forward()) calls `holdForApplication(accountId, applicationId,
 * requestId, amount)`. We try the application wallet first, then fall back to
 * the shared account wallet for any shortfall. Each debit creates a separate
 * WalletTransaction row (suffixed `:app` and `:account` for unique requestId).
 *
 * Settle/refund reverse the debits in same order (refund app portion first).
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name)

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async getAccountBalance(accountId: string): Promise<{ tokenBalance: bigint; refundOnError: boolean }> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { tokenBalance: true, refundOnError: true },
    })
    if (!account) throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })
    return account
  }

  /** Backwards-compat alias used by /v1/wallet controller. */
  getBalance = this.getAccountBalance.bind(this)

  async getApplicationBalance(applicationId: string): Promise<{ tokenBalance: bigint; accountId: string }> {
    const app = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { tokenBalance: true, accountId: true },
    })
    if (!app) throw new NotFoundException({ message: 'Application not found', code: 'APPLICATION_NOT_FOUND' })
    return app
  }

  /** Combined view for an account: shared + per-app totals. */
  async getCombinedView(accountId: string): Promise<{
    sharedBalance: bigint
    refundOnError: boolean
    applications: { id: string; name: string; tokenBalance: bigint }[]
    totalAvailable: bigint
  }> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: {
        tokenBalance: true,
        refundOnError: true,
        applications: {
          where: { isActive: true },
          select: { id: true, name: true, tokenBalance: true },
          orderBy: { name: 'asc' },
        },
      },
    })
    if (!account) throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })

    const totalAvailable =
      account.tokenBalance +
      account.applications.reduce((sum, a) => sum + a.tokenBalance, 0n)

    return {
      sharedBalance: account.tokenBalance,
      refundOnError: account.refundOnError,
      applications: account.applications,
      totalAvailable,
    }
  }

  async listTransactions(
    accountId: string,
    opts: { limit: number; cursor?: string; type?: WalletTxType; applicationId?: string | null },
  ): Promise<{ transactions: WalletTransaction[]; total: number }> {
    const where: Prisma.WalletTransactionWhereInput = {
      accountId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.cursor ? { id: { lt: opts.cursor } } : {}),
      ...(opts.applicationId !== undefined
        ? { applicationId: opts.applicationId }
        : {}),
    }
    const countWhere: Prisma.WalletTransactionWhereInput = {
      accountId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.applicationId !== undefined
        ? { applicationId: opts.applicationId }
        : {}),
    }
    const [transactions, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
      }),
      this.prisma.walletTransaction.count({ where: countWhere }),
    ])
    return { transactions, total }
  }

  // ---------------------------------------------------------------------------
  // Hold — cross-wallet (app first, then account)
  // ---------------------------------------------------------------------------

  /**
   * Application-scoped hold: try Application.tokenBalance first, fallback to
   * Account.tokenBalance for any remaining amount. Returns array of holds
   * created (1 or 2 rows).
   *
   * Throws PaymentRequiredException(INSUFFICIENT_TOKEN_BALANCE) when the
   * combined balance is too low.
   *
   * Wrapped in `$transaction` so balance decrements + ledger inserts are
   * atomic — any throw rolls back BOTH wallet decrements and the HOLD rows,
   * leaving no orphaned ledger entries that would trip retry idempotency.
   */
  async holdForApplication(
    accountId: string,
    applicationId: string,
    requestId: string,
    amount: bigint,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction[]> {
    if (amount <= 0n) throw new Error(`hold amount must be positive, got ${amount}`)

    // Idempotency on retry — checked outside the tx because it's a read-only fast path.
    const existing = await this.prisma.walletTransaction.findMany({
      where: {
        OR: [
          { requestId: `${requestId}:app` },
          { requestId: `${requestId}:account` },
        ],
      },
    })
    if (existing.length > 0) return existing

    return this.prisma.$transaction(async (tx) => {
      // Re-check inside the tx — concurrent caller may have populated rows.
      const dupe = await tx.walletTransaction.findMany({
        where: {
          OR: [
            { requestId: `${requestId}:app` },
            { requestId: `${requestId}:account` },
          ],
        },
      })
      if (dupe.length > 0) return dupe

      // Read balances inside the tx so we see a consistent snapshot.
      const [app, account] = await Promise.all([
        tx.application.findUnique({
          where: { id: applicationId },
          select: { tokenBalance: true, accountId: true },
        }),
        tx.account.findUnique({
          where: { id: accountId },
          select: { tokenBalance: true },
        }),
      ])
      if (!app || app.accountId !== accountId) {
        throw new NotFoundException({ message: 'Application not found', code: 'APPLICATION_NOT_FOUND' })
      }
      if (!account) {
        throw new NotFoundException({ message: 'Account not found', code: 'ACCOUNT_NOT_FOUND' })
      }

      const total = app.tokenBalance + account.tokenBalance
      if (total < amount) {
        throw new PaymentRequiredException({
          message: 'Insufficient token balance to hold for this request.',
          code: 'INSUFFICIENT_TOKEN_BALANCE',
        })
      }

      const fromApp = app.tokenBalance >= amount ? amount : app.tokenBalance
      const fromAccount = amount - fromApp

      const holds: WalletTransaction[] = []

      if (fromApp > 0n) {
        const ok = await tx.application.updateMany({
          where: { id: applicationId, tokenBalance: { gte: fromApp } },
          data: { tokenBalance: { decrement: fromApp } },
        })
        if (ok.count === 0) {
          // Race lost — concurrent request drained the wallet between our
          // snapshot read and the guarded update. Throwing aborts the tx,
          // so any prior writes in this tx (none here) are rolled back.
          throw new PaymentRequiredException({
            message: 'Insufficient token balance to hold for this request.',
            code: 'INSUFFICIENT_TOKEN_BALANCE',
          })
        }
        const updatedApp = await tx.application.findUnique({
          where: { id: applicationId },
          select: { tokenBalance: true },
        })
        holds.push(
          await tx.walletTransaction.create({
            data: {
              accountId,
              applicationId,
              type: 'HOLD',
              amount: -fromApp,
              balanceAfter: updatedApp!.tokenBalance,
              requestId: `${requestId}:app`,
              metadata: this.toJson({ source: 'application', ...metadata }),
            },
          }),
        )
      }

      if (fromAccount > 0n) {
        const ok = await tx.account.updateMany({
          where: { id: accountId, tokenBalance: { gte: fromAccount }, deletedAt: null },
          data: { tokenBalance: { decrement: fromAccount } },
        })
        if (ok.count === 0) {
          // Race lost on account wallet — throwing rolls back the app debit
          // + HOLD row created above (Prisma interactive tx rollback).
          throw new PaymentRequiredException({
            message: 'Insufficient token balance to hold for this request.',
            code: 'INSUFFICIENT_TOKEN_BALANCE',
          })
        }
        const updatedAcct = await tx.account.findUnique({
          where: { id: accountId },
          select: { tokenBalance: true },
        })
        holds.push(
          await tx.walletTransaction.create({
            data: {
              accountId,
              applicationId: null,
              type: 'HOLD',
              amount: -fromAccount,
              balanceAfter: updatedAcct!.tokenBalance,
              requestId: `${requestId}:account`,
              metadata: this.toJson({ source: 'account', ...metadata }),
            },
          }),
        )
      }

      return holds
    })
  }

  /**
   * Settle a previously-held cross-wallet request against actual usage.
   * Refunds proportionally from each source (app first, then account).
   */
  async settleForApplication(
    requestId: string,
    actualAmount: bigint,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const holds = await this.prisma.walletTransaction.findMany({
      where: {
        requestId: { in: [`${requestId}:app`, `${requestId}:account`] },
        type: 'HOLD',
      },
    })
    if (holds.length === 0) return

    // Already settled? Look for any tx with metadata.holdRequestId equal to ours.
    const settled = await this.prisma.walletTransaction.findFirst({
      where: { metadata: { path: ['holdRequestId'], equals: requestId } },
    })
    if (settled) return

    const totalHeld = holds.reduce((s, h) => s + -h.amount, 0n)
    const overrun = actualAmount > totalHeld

    // Allocate the actual usage across the holds in order (app first)
    let remainingActual = actualAmount
    for (const hold of holds) {
      const heldAmount = -hold.amount
      const usedHere = remainingActual >= heldAmount ? heldAmount : remainingActual
      const refundHere = heldAmount - usedHere
      remainingActual -= usedHere

      if (refundHere > 0n) {
        // Refund unused portion
        if (hold.applicationId) {
          await this.prisma.application.update({
            where: { id: hold.applicationId },
            data: { tokenBalance: { increment: refundHere } },
          })
          const a = await this.prisma.application.findUnique({
            where: { id: hold.applicationId },
            select: { tokenBalance: true },
          })
          await this.prisma.walletTransaction.create({
            data: {
              accountId: hold.accountId,
              applicationId: hold.applicationId,
              type: 'REFUND',
              amount: refundHere,
              balanceAfter: a!.tokenBalance,
              metadata: this.toJson({ holdRequestId: requestId, source: 'application', ...metadata }),
            },
          })
        } else {
          await this.prisma.account.update({
            where: { id: hold.accountId },
            data: { tokenBalance: { increment: refundHere } },
          })
          const a = await this.prisma.account.findUnique({
            where: { id: hold.accountId },
            select: { tokenBalance: true },
          })
          await this.prisma.walletTransaction.create({
            data: {
              accountId: hold.accountId,
              applicationId: null,
              type: 'REFUND',
              amount: refundHere,
              balanceAfter: a!.tokenBalance,
              metadata: this.toJson({ holdRequestId: requestId, source: 'account', ...metadata }),
            },
          })
        }
      } else {
        // Fully consumed — emit a 0-delta SETTLE row for audit trail
        const balanceAfter = hold.applicationId
          ? (await this.prisma.application.findUnique({
              where: { id: hold.applicationId },
              select: { tokenBalance: true },
            }))!.tokenBalance
          : (await this.prisma.account.findUnique({
              where: { id: hold.accountId },
              select: { tokenBalance: true },
            }))!.tokenBalance
        await this.prisma.walletTransaction.create({
          data: {
            accountId: hold.accountId,
            applicationId: hold.applicationId,
            type: 'SETTLE',
            amount: 0n,
            balanceAfter,
            metadata: this.toJson({
              holdRequestId: requestId,
              source: hold.applicationId ? 'application' : 'account',
              consumed: heldAmount.toString(),
              ...metadata,
            }),
          },
        })
      }
    }

    if (overrun) {
      this.logger.warn(
        `Cost overrun for requestId=${requestId}: actual=${actualAmount}, held=${totalHeld}`,
      )
    }
  }

  /** Full refund — releases entire hold (provider error, etc.). */
  async refundForApplication(
    requestId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const holds = await this.prisma.walletTransaction.findMany({
      where: {
        requestId: { in: [`${requestId}:app`, `${requestId}:account`] },
        type: 'HOLD',
      },
    })
    if (holds.length === 0) return

    const settled = await this.prisma.walletTransaction.findFirst({
      where: { metadata: { path: ['holdRequestId'], equals: requestId } },
    })
    if (settled) return

    for (const hold of holds) {
      const heldAmount = -hold.amount
      if (hold.applicationId) {
        await this.prisma.application.update({
          where: { id: hold.applicationId },
          data: { tokenBalance: { increment: heldAmount } },
        })
        const a = await this.prisma.application.findUnique({
          where: { id: hold.applicationId },
          select: { tokenBalance: true },
        })
        await this.prisma.walletTransaction.create({
          data: {
            accountId: hold.accountId,
            applicationId: hold.applicationId,
            type: 'REFUND',
            amount: heldAmount,
            balanceAfter: a!.tokenBalance,
            metadata: this.toJson({ holdRequestId: requestId, reason, source: 'application', ...metadata }),
          },
        })
      } else {
        await this.prisma.account.update({
          where: { id: hold.accountId },
          data: { tokenBalance: { increment: heldAmount } },
        })
        const a = await this.prisma.account.findUnique({
          where: { id: hold.accountId },
          select: { tokenBalance: true },
        })
        await this.prisma.walletTransaction.create({
          data: {
            accountId: hold.accountId,
            applicationId: null,
            type: 'REFUND',
            amount: heldAmount,
            balanceAfter: a!.tokenBalance,
            metadata: this.toJson({ holdRequestId: requestId, reason, source: 'account', ...metadata }),
          },
        })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Legacy single-source API (still used by checkout webhook + admin grant)
  // ---------------------------------------------------------------------------

  /** @deprecated kept for backwards-compat with M1 admin grant; new code uses holdForApplication. */
  async hold(
    accountId: string,
    requestId: string,
    amount: bigint,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction> {
    if (amount <= 0n) throw new Error(`hold amount must be positive, got ${amount}`)
    const existing = await this.prisma.walletTransaction.findUnique({ where: { requestId } })
    if (existing) return existing
    const result = await this.prisma.account.updateMany({
      where: { id: accountId, tokenBalance: { gte: amount }, deletedAt: null },
      data: { tokenBalance: { decrement: amount } },
    })
    if (result.count === 0) {
      throw new PaymentRequiredException({
        message: 'Insufficient token balance to hold for this request.',
        code: 'INSUFFICIENT_TOKEN_BALANCE',
      })
    }
    const acct = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { tokenBalance: true },
    })
    return this.prisma.walletTransaction.create({
      data: {
        accountId,
        type: 'HOLD',
        amount: -amount,
        balanceAfter: acct!.tokenBalance,
        requestId,
        metadata: this.toJson(metadata),
      },
    })
  }

  /** @deprecated kept for backwards-compat. */
  async settle(
    requestId: string,
    actualAmount: bigint,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction | null> {
    const hold = await this.prisma.walletTransaction.findUnique({ where: { requestId } })
    if (!hold || hold.type !== 'HOLD') return null
    const settled = await this.prisma.walletTransaction.findFirst({
      where: { metadata: { path: ['holdId'], equals: hold.id } },
    })
    if (settled) return settled

    const holdAmount = -hold.amount
    const delta = holdAmount - actualAmount

    if (delta !== 0n) {
      await this.prisma.account.update({
        where: { id: hold.accountId },
        data: { tokenBalance: { increment: delta } },
      })
    }

    const acct = await this.prisma.account.findUnique({
      where: { id: hold.accountId },
      select: { tokenBalance: true },
    })

    return this.prisma.walletTransaction.create({
      data: {
        accountId: hold.accountId,
        type: delta > 0n ? 'REFUND' : 'SETTLE',
        amount: delta,
        balanceAfter: acct!.tokenBalance,
        metadata: this.toJson({ holdId: hold.id, actualAmount: actualAmount.toString(), ...metadata }),
      },
    })
  }

  /** @deprecated kept for backwards-compat. */
  async refund(
    requestId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction | null> {
    const hold = await this.prisma.walletTransaction.findUnique({ where: { requestId } })
    if (!hold || hold.type !== 'HOLD') return null
    const settled = await this.prisma.walletTransaction.findFirst({
      where: { metadata: { path: ['holdId'], equals: hold.id } },
    })
    if (settled) return settled

    const holdAmount = -hold.amount
    await this.prisma.account.update({
      where: { id: hold.accountId },
      data: { tokenBalance: { increment: holdAmount } },
    })
    const acct = await this.prisma.account.findUnique({
      where: { id: hold.accountId },
      select: { tokenBalance: true },
    })
    return this.prisma.walletTransaction.create({
      data: {
        accountId: hold.accountId,
        type: 'REFUND',
        amount: holdAmount,
        balanceAfter: acct!.tokenBalance,
        metadata: this.toJson({ holdId: hold.id, reason, ...metadata }),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // End-user wallet (B2B2C) — strict, no fallback
  // ---------------------------------------------------------------------------
  //
  // Per-end-user holds use a SINGLE source: the EndUser.tokenBalance. There is
  // intentionally no fallback to the application or account wallet — the whole
  // point of the per-end-user model is that the end-user pays for themselves.
  // If the wallet is empty, the integrator's app gets a 402 and shows them a
  // top-up button (which calls /v1/billing/checkout with scope=PER_END_USER).

  async getEndUserBalance(endUserId: string): Promise<{ tokenBalance: bigint; applicationId: string }> {
    const eu = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { tokenBalance: true, applicationId: true },
    })
    if (!eu) throw new NotFoundException({ message: 'End user not found', code: 'END_USER_NOT_FOUND' })
    return eu
  }

  async holdForEndUser(
    accountId: string,
    applicationId: string,
    endUserId: string,
    requestId: string,
    amount: bigint,
    metadata?: Record<string, unknown>,
  ): Promise<WalletTransaction> {
    if (amount <= 0n) throw new Error(`hold amount must be positive, got ${amount}`)

    const dupe = await this.prisma.walletTransaction.findUnique({
      where: { requestId: `${requestId}:enduser` },
    })
    if (dupe) return dupe

    return this.prisma.$transaction(async (tx) => {
      // Recheck idempotency inside the tx — concurrent caller may have inserted.
      const dupe2 = await tx.walletTransaction.findUnique({
        where: { requestId: `${requestId}:enduser` },
      })
      if (dupe2) return dupe2

      const eu = await tx.endUser.findUnique({
        where: { id: endUserId },
        select: { tokenBalance: true, applicationId: true },
      })
      if (!eu || eu.applicationId !== applicationId) {
        throw new NotFoundException({ message: 'End user not found', code: 'END_USER_NOT_FOUND' })
      }
      if (eu.tokenBalance < amount) {
        throw new PaymentRequiredException({
          message: 'Insufficient token balance to hold for this request.',
          code: 'INSUFFICIENT_TOKEN_BALANCE',
        })
      }

      const ok = await tx.endUser.updateMany({
        where: { id: endUserId, tokenBalance: { gte: amount } },
        data: { tokenBalance: { decrement: amount } },
      })
      if (ok.count === 0) {
        // Race lost — concurrent request drained the wallet between the
        // snapshot read and the guarded update. Throwing aborts the tx.
        throw new PaymentRequiredException({
          message: 'Insufficient token balance to hold for this request.',
          code: 'INSUFFICIENT_TOKEN_BALANCE',
        })
      }

      const updated = await tx.endUser.findUnique({
        where: { id: endUserId },
        select: { tokenBalance: true },
      })
      return tx.walletTransaction.create({
        data: {
          accountId,
          applicationId,
          endUserId,
          type: 'HOLD',
          amount: -amount,
          balanceAfter: updated!.tokenBalance,
          requestId: `${requestId}:enduser`,
          metadata: this.toJson({ source: 'end_user', ...metadata }),
        },
      })
    })
  }

  /** Settle a previously-held end-user request against actual usage. */
  async settleForEndUser(
    requestId: string,
    actualAmount: bigint,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const hold = await this.prisma.walletTransaction.findUnique({
      where: { requestId: `${requestId}:enduser` },
    })
    if (!hold || hold.type !== 'HOLD' || !hold.endUserId) return

    // Already settled? (look for any tx with metadata.holdRequestId equal to ours)
    const settled = await this.prisma.walletTransaction.findFirst({
      where: { metadata: { path: ['holdRequestId'], equals: requestId } },
    })
    if (settled) return

    const heldAmount = -hold.amount
    const refundDelta = heldAmount - actualAmount // positive: refund some; zero/neg: full consume + maybe overrun

    if (refundDelta > 0n) {
      await this.prisma.endUser.update({
        where: { id: hold.endUserId },
        data: { tokenBalance: { increment: refundDelta } },
      })
      const updated = await this.prisma.endUser.findUnique({
        where: { id: hold.endUserId },
        select: { tokenBalance: true },
      })
      await this.prisma.walletTransaction.create({
        data: {
          accountId: hold.accountId,
          applicationId: hold.applicationId,
          endUserId: hold.endUserId,
          type: 'REFUND',
          amount: refundDelta,
          balanceAfter: updated!.tokenBalance,
          metadata: this.toJson({
            holdRequestId: requestId,
            source: 'end_user',
            actualAmount: actualAmount.toString(),
            ...metadata,
          }),
        },
      })
    } else {
      const updated = await this.prisma.endUser.findUnique({
        where: { id: hold.endUserId },
        select: { tokenBalance: true },
      })
      const overrun = -refundDelta // > 0 if actual exceeded hold
      await this.prisma.walletTransaction.create({
        data: {
          accountId: hold.accountId,
          applicationId: hold.applicationId,
          endUserId: hold.endUserId,
          type: 'SETTLE',
          amount: 0n,
          balanceAfter: updated!.tokenBalance,
          metadata: this.toJson({
            holdRequestId: requestId,
            source: 'end_user',
            consumed: heldAmount.toString(),
            actualAmount: actualAmount.toString(),
            ...(overrun > 0n ? { overrun: overrun.toString() } : {}),
            ...metadata,
          }),
        },
      })
      if (overrun > 0n) {
        this.logger.warn(
          `End-user cost overrun for requestId=${requestId}: actual=${actualAmount}, held=${heldAmount}`,
        )
      }
    }
  }

  /** Full refund of an end-user hold (provider error etc.). */
  async refundForEndUser(
    requestId: string,
    reason: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const hold = await this.prisma.walletTransaction.findUnique({
      where: { requestId: `${requestId}:enduser` },
    })
    if (!hold || hold.type !== 'HOLD' || !hold.endUserId) return
    const settled = await this.prisma.walletTransaction.findFirst({
      where: { metadata: { path: ['holdRequestId'], equals: requestId } },
    })
    if (settled) return

    const heldAmount = -hold.amount
    await this.prisma.endUser.update({
      where: { id: hold.endUserId },
      data: { tokenBalance: { increment: heldAmount } },
    })
    const updated = await this.prisma.endUser.findUnique({
      where: { id: hold.endUserId },
      select: { tokenBalance: true },
    })
    await this.prisma.walletTransaction.create({
      data: {
        accountId: hold.accountId,
        applicationId: hold.applicationId,
        endUserId: hold.endUserId,
        type: 'REFUND',
        amount: heldAmount,
        balanceAfter: updated!.tokenBalance,
        metadata: this.toJson({ holdRequestId: requestId, reason, source: 'end_user', ...metadata }),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Credit (top-up / subscription grant) — picks wallet by scope
  // ---------------------------------------------------------------------------

  async credit(
    accountId: string,
    type: Extract<WalletTxType, 'TOPUP' | 'SUBSCRIPTION_GRANT' | 'SUBSCRIPTION_RESET' | 'ADJUST'>,
    amount: bigint,
    opts?: {
      stripeEventId?: string
      metadata?: Record<string, unknown>
      /** When set, credits the application wallet (mutually exclusive with endUserId). */
      applicationId?: string | null
      /** When set, credits the end-user wallet (highest priority). */
      endUserId?: string | null
    },
  ): Promise<WalletTransaction> {
    if (amount <= 0n) throw new Error(`credit amount must be positive, got ${amount}`)

    if (opts?.stripeEventId) {
      const existing = await this.prisma.walletTransaction.findUnique({
        where: { stripeEventId: opts.stripeEventId },
      })
      if (existing) return existing
    }

    const endUserId = opts?.endUserId ?? null
    const applicationId = opts?.applicationId ?? null

    // End-user wallet has highest priority. Application is implicit (looked up
    // from the EndUser row) so callers don't have to pass it explicitly when
    // crediting an end-user.
    if (endUserId) {
      const eu = await this.prisma.endUser.findUnique({
        where: { id: endUserId },
        select: { applicationId: true },
      })
      if (!eu) {
        throw new NotFoundException({ message: 'End user not found', code: 'END_USER_NOT_FOUND' })
      }
      if (type === 'SUBSCRIPTION_RESET') {
        await this.prisma.endUser.update({
          where: { id: endUserId },
          data: { tokenBalance: amount },
        })
      } else {
        await this.prisma.endUser.update({
          where: { id: endUserId },
          data: { tokenBalance: { increment: amount } },
        })
      }
      const updated = await this.prisma.endUser.findUnique({
        where: { id: endUserId },
        select: { tokenBalance: true },
      })
      return this.prisma.walletTransaction.create({
        data: {
          accountId,
          applicationId: eu.applicationId,
          endUserId,
          type,
          amount,
          balanceAfter: updated!.tokenBalance,
          stripeEventId: opts?.stripeEventId ?? null,
          metadata: this.toJson({ scope: 'PER_END_USER', ...opts?.metadata }),
        },
      })
    }

    if (applicationId) {
      // Credit application wallet
      if (type === 'SUBSCRIPTION_RESET') {
        await this.prisma.application.update({
          where: { id: applicationId },
          data: { tokenBalance: amount },
        })
      } else {
        await this.prisma.application.update({
          where: { id: applicationId },
          data: { tokenBalance: { increment: amount } },
        })
      }
      const app = await this.prisma.application.findUnique({
        where: { id: applicationId },
        select: { tokenBalance: true },
      })
      return this.prisma.walletTransaction.create({
        data: {
          accountId,
          applicationId,
          type,
          amount,
          balanceAfter: app!.tokenBalance,
          stripeEventId: opts?.stripeEventId ?? null,
          metadata: this.toJson({ scope: 'PER_APPLICATION', ...opts?.metadata }),
        },
      })
    }

    // Credit account (shared) wallet
    if (type === 'SUBSCRIPTION_RESET') {
      await this.prisma.account.update({
        where: { id: accountId },
        data: { tokenBalance: amount },
      })
    } else {
      await this.prisma.account.update({
        where: { id: accountId },
        data: { tokenBalance: { increment: amount } },
      })
    }
    const acct = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { tokenBalance: true },
    })
    return this.prisma.walletTransaction.create({
      data: {
        accountId,
        applicationId: null,
        type,
        amount,
        balanceAfter: acct!.tokenBalance,
        stripeEventId: opts?.stripeEventId ?? null,
        metadata: this.toJson({ scope: 'SHARED_ACCOUNT', ...opts?.metadata }),
      },
    })
  }

  /** Admin manual grant — wraps credit(ADJUST) + audit log. */
  async adminGrant(
    accountId: string,
    amount: bigint,
    reason: string,
    actor: { actorId: string; actorType: 'ADMIN' },
    ctx: { ipAddress?: string; userAgent?: string },
    opts?: { applicationId?: string | null; endUserId?: string | null },
  ): Promise<WalletTransaction> {
    const tx = await this.credit(accountId, 'ADJUST', amount, {
      metadata: { reason, grantedBy: actor.actorId },
      applicationId: opts?.applicationId ?? null,
      endUserId: opts?.endUserId ?? null,
    })

    const resource = opts?.endUserId
      ? `end_user:${opts.endUserId}/wallet`
      : opts?.applicationId
        ? `application:${opts.applicationId}/wallet`
        : `account:${accountId}/wallet`

    await this.audit.log({
      accountId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'wallet.granted',
      resource,
      metadata: {
        amount: amount.toString(),
        reason,
        txId: tx.id,
        applicationId: opts?.applicationId ?? null,
        endUserId: opts?.endUserId ?? null,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    })

    return tx
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!value) return Prisma.JsonNull
    return value as Prisma.InputJsonValue
  }
}
