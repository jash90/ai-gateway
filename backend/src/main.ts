import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'
import { cleanupOpenApiDoc } from 'nestjs-zod'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'
import { LoggingInterceptor } from './common/interceptors/logging.interceptor'
import { validateEnv } from './config/config'

async function bootstrap() {
  const env = validateEnv()

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 1024 * 1024, // 1 MB request body cap
    }),
  )

  // Many HTTP clients (Orval-generated TanStack Query, browser fetch wrappers)
  // send `Content-Type: application/json` on every request, including DELETE
  // with no body. Fastify's default JSON parser then throws 400
  // "Body cannot be empty when content-type is set".
  //
  // Workaround: register a `preParsing` hook that strips Content-Type when
  // there's no payload. Runs BEFORE the content-type parser, so Fastify just
  // skips parsing entirely.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('preParsing', (request, _reply, payload, done) => {
      const len = request.headers['content-length']
      const hasBody = len !== undefined && Number(len) > 0
      if (!hasBody && request.headers['content-type']) {
        delete request.headers['content-type']
      }
      done(null, payload)
    })

  // No global prefix — controllers already include 'v1' in their routes
  // health controller is excluded from auth by @Public() decorator

  // CORS
  app.enableCors({
    origin: env.NODE_ENV === 'production' ? false : true,
  })

  // Global validation: ZodValidationPipe is wired via APP_PIPE in app.module.ts.
  // We deliberately DO NOT use the legacy class-validator ValidationPipe — it would
  // run BEFORE the nestjs-zod pipe and reject all unknown properties (Zod DTOs are
  // class wrappers without @IsDefined / @ValidateNested decorators).

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter())

  // Global logging interceptor
  app.useGlobalInterceptors(new LoggingInterceptor())

  // Swagger / OpenAPI spec
  const config = new DocumentBuilder()
    .setTitle('Raccoon AI Gateway API')
    .setDescription(
      [
        'BYOK gateway for OpenAI, Anthropic, and OpenRouter.',
        '',
        '## Authentication',
        '',
        '- **Control plane** (`/v1/auth/*`, `/v1/apps/*`, `/v1/provider-keys/*`, `/v1/admin/*`): JWT Bearer token from `POST /v1/auth/login`.',
        '- **Data plane** (`/v1/chat/completions`, `/v1/messages`, planned for Sprint 2): Application key, format `sk-rcn-live-...`, sent as `Authorization: Bearer ...`.',
        '- **Admin endpoints**: JWT with `role=ADMIN` is preferred. `X-Admin-Key` header (env `ADMIN_API_KEY`) accepted as a legacy fallback for scripts.',
        '',
        '## Token lifecycle',
        '',
        '- Access token TTL: 15 minutes.',
        '- Refresh token TTL: 30 days, rotated on every `POST /v1/auth/refresh`.',
        '- Refresh token reuse detection: re-using a rotated token revokes the entire family.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'JWT access token from POST /v1/auth/login or POST /v1/auth/refresh. Expires after 15 minutes.',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Admin-Key',
        in: 'header',
        description:
          'Legacy admin auth fallback. Prefer JWT with role=ADMIN. Every use is audited.',
      },
      'admin-key',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'sk-rcn-live-...',
        description:
          'Application key (data plane). Format: `sk-rcn-live-...`. Generate one in /v1/apps/:id/keys.',
      },
      'application-key',
    )
    .addTag('auth', 'Account registration, email verification, login, refresh, password reset')
    .addTag('applications', 'CRUD for Applications (multi-app support per Account)')
    .addTag('application-keys', 'sk-rcn-live-... data plane keys per Application')
    .addTag('provider-keys', 'BYOK keys to OpenAI / Anthropic / OpenRouter (envelope-encrypted)')
    .addTag('admin', 'Admin-only endpoints (multi-tenant view)')
    .build()
  const document = SwaggerModule.createDocument(app, config)
  // cleanupOpenApiDoc inlines $ref-only schemas and removes nestjs-zod's
  // internal markers. Without it, Orval generates broken "unknown" types.
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(document), {
    swaggerOptions: {
      persistAuthorization: true,
    },
  })

  await app.listen(env.PORT, '0.0.0.0')
  console.log(`AI Gateway running on http://localhost:${env.PORT}`)
  console.log(`Swagger docs at http://localhost:${env.PORT}/docs`)
}
bootstrap()
