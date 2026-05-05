import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { GatewayController } from './gateway.controller'
import { GatewayService } from './gateway.service'
import { UsageRecorderWorker, USAGE_RECORDING_QUEUE } from './workers/usage-recorder.worker'
import { ProviderRouterService } from './services/provider-router.service'
import { ByokKeyResolverService } from './services/byok-key-resolver.service'
import { UsageRecorderService } from './services/usage-recorder.service'
import { EndUserResolverService } from './services/end-user-resolver.service'
import { ModelsAggregatorService } from './services/models-aggregator.service'
import { CostCalculatorService } from './services/cost-calculator.service'
import { TokenEstimatorService } from './services/token-estimator.service'
import { ProviderErrorMapper } from './services/provider-error-mapper.service'
import { OpenAIProvider } from './providers/openai.provider'
import { AnthropicProvider } from './providers/anthropic.provider'
import { OpenRouterProvider } from './providers/openrouter.provider'
import { AuthModule } from '../auth/auth.module'
import { CryptoModule } from '../crypto/crypto.module'
import { WebhooksModule } from '../webhooks/webhooks.module'
import { WalletModule } from '../wallet/wallet.module'
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module'

@Module({
  imports: [
    AuthModule,
    CryptoModule,
    WebhooksModule,
    WalletModule,
    FeatureFlagsModule,
    BullModule.registerQueue({ name: USAGE_RECORDING_QUEUE }),
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    ProviderRouterService,
    ByokKeyResolverService,
    UsageRecorderService,
    EndUserResolverService,
    ModelsAggregatorService,
    CostCalculatorService,
    TokenEstimatorService,
    ProviderErrorMapper,
    OpenAIProvider,
    AnthropicProvider,
    OpenRouterProvider,
    UsageRecorderWorker,
  ],
  exports: [ByokKeyResolverService],
})
export class GatewayModule {}
