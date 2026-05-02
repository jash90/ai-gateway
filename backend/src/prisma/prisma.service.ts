import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Account read operations that should be auto-filtered to `deletedAt: null`
 * unless the caller explicitly opts out.
 */
const SOFT_DELETE_READ_OPS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Inject `deletedAt: null` into Prisma `where` arguments for Account reads.
 * Pre-existing fields win — callers that explicitly need deleted rows can pass
 * `deletedAt: { not: null }` or `deletedAt: undefined` and bypass the filter.
 */
function injectAccountSoftDeleteFilter(args: Prisma.AccountFindManyArgs): void {
  const where = args.where as Record<string, unknown> | undefined;
  if (where && 'deletedAt' in where) return; // explicit opt-out
  args.where = { ...(where ?? {}), deletedAt: null } as Prisma.AccountWhereInput;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Raw Account delegate — bypasses the soft-delete filter applied to
   * `this.account`. Use ONLY when you must operate on or see deleted rows:
   *   - AccountDeletionService.hardDelete (cooling-off worker → GDPR erasure)
   *   - JwtAuthGuard / AdminGuard (so deleted accounts get a specific error)
   *   - AdminService.listAccounts({ includeDeleted: true })
   *
   * Every other consumer should keep using `this.account` (auto-filtered).
   * Set in onModuleInit BEFORE the `account` getter is overridden.
   */
  accountRaw!: PrismaClient['account'];

  async onModuleInit() {
    await this.$connect();

    // Capture the raw delegate BEFORE applying the extension. The right-hand
    // side hits the original PrismaClient getter; assigning to a regular
    // instance property stores a stable reference that subsequent calls to
    // `this.accountRaw` will read directly.
    this.accountRaw = this.account;

    // Apply the soft-delete extension to Account reads. The extension returns a
    // NEW Proxy over `this`, so we replace the `account` delegate in-place to
    // keep the rest of the class shape untouched. Transactions started via
    // `$transaction(async tx => ...)` use a fresh client and are NOT covered —
    // explicit `deletedAt: null` is still required inside transactions.
    const extended = this.$extends({
      name: 'softDelete:Account',
      query: {
        account: {
          async $allOperations({ operation, args, query }) {
            if (SOFT_DELETE_READ_OPS.has(operation)) {
              injectAccountSoftDeleteFilter(args as Prisma.AccountFindManyArgs);
            }
            return query(args);
          },
        },
      },
    });

    Object.defineProperty(this, 'account', {
      configurable: true,
      enumerable: true,
      get: () => extended.account,
    });
    this.logger.log('Soft-delete extension applied to Account model.');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
