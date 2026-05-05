import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { AuditModule } from '../audit/audit.module'
import { CryptoModule } from '../crypto/crypto.module'
import { WalletModule } from '../wallet/wallet.module'
import { BillingAdminController } from './billing.admin.controller'
import { BillingController } from './billing.controller'
import { EndUserBillingController } from './end-user-billing.controller'
import { StripeWebhookController } from './webhook/stripe-webhook.controller'
import { StripeConfigService } from './services/stripe-config.service'
import { StripeClientFactory } from './services/stripe-client.factory'
import { ProductsService } from './services/products.service'
import { CheckoutService } from './services/checkout.service'
import { SubscriptionsService } from './services/subscriptions.service'

@Module({
  imports: [AuthModule, AuditModule, CryptoModule, WalletModule],
  controllers: [
    BillingAdminController,
    BillingController,
    EndUserBillingController,
    StripeWebhookController,
  ],
  providers: [
    StripeConfigService,
    StripeClientFactory,
    ProductsService,
    CheckoutService,
    SubscriptionsService,
  ],
  exports: [
    StripeConfigService,
    StripeClientFactory,
    ProductsService,
    CheckoutService,
    SubscriptionsService,
  ],
})
export class BillingModule {}
