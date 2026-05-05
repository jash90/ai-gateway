import { Module, forwardRef } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { PasswordService } from './services/password.service'
import { TokenService } from './services/token.service'
import { RefreshTokenService } from './services/refresh-token.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { ApplicationKeyGuard } from './guards/application-key.guard'
import { ClientAuthGuard } from './guards/client-auth.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AccountDeletionService } from './services/account-deletion.service'
import { AuditModule } from '../audit/audit.module'
import { EmailsModule } from '../emails/emails.module'

@Module({
  imports: [
    forwardRef(() => AuditModule),
    EmailsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET')
        if (!secret || secret.length < 32) {
          throw new Error(
            'JWT_SECRET must be set in env and at least 32 chars long. Generate with: openssl rand -base64 32',
          )
        }
        return {
          secret,
          signOptions: {
            expiresIn: '15m',
            issuer: 'raccoon',
            audience: 'raccoon-api',
          },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    JwtAuthGuard,
    ApplicationKeyGuard,
    ClientAuthGuard,
    AdminGuard,
    AccountDeletionService,
  ],
  exports: [
    JwtAuthGuard,
    ApplicationKeyGuard,
    ClientAuthGuard,
    AdminGuard,
    TokenService,
    PasswordService,
    AccountDeletionService,
  ],
})
export class AuthModule {}
