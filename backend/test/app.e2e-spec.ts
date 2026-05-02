import { describe, beforeEach, it } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './../src/app.module'

describe('App (e2e)', () => {
  let app: NestFastifyApplication

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()
  })

  it('/health (GET)', () => {
    return app.inject({
      method: 'GET',
      url: '/health',
    })
  })
})
