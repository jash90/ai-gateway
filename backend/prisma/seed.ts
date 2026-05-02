import { PrismaClient } from '@prisma/client'
import * as argon2 from 'argon2'

const prisma = new PrismaClient()

// =============================================================================
// Pricing data — info-only, drives costUsd computation on UsageEvent.
// Values are USD per `unitSize` units (default per-million tokens).
// Update as providers change pricing; old rows kept (validUntil populated).
// =============================================================================

const PRICING_DATA: Array<{
  provider: 'OPENAI' | 'ANTHROPIC' | 'OPENROUTER'
  model: string
  costType: string
  costPerUnit: number
  unitSize?: number
}> = [
  // Anthropic
  { provider: 'ANTHROPIC', model: 'claude-opus-4-7', costType: 'INPUT_TOKEN', costPerUnit: 5 },
  { provider: 'ANTHROPIC', model: 'claude-opus-4-7', costType: 'OUTPUT_TOKEN', costPerUnit: 25 },
  { provider: 'ANTHROPIC', model: 'claude-sonnet-4-5', costType: 'INPUT_TOKEN', costPerUnit: 3 },
  { provider: 'ANTHROPIC', model: 'claude-sonnet-4-5', costType: 'OUTPUT_TOKEN', costPerUnit: 15 },
  { provider: 'ANTHROPIC', model: 'claude-sonnet-4-5', costType: 'CACHE_READ_TOKEN', costPerUnit: 0.3 },
  { provider: 'ANTHROPIC', model: 'claude-sonnet-4-5', costType: 'CACHE_WRITE_TOKEN', costPerUnit: 3.75 },
  { provider: 'ANTHROPIC', model: 'claude-haiku-4-5', costType: 'INPUT_TOKEN', costPerUnit: 1 },
  { provider: 'ANTHROPIC', model: 'claude-haiku-4-5', costType: 'OUTPUT_TOKEN', costPerUnit: 5 },

  // OpenAI
  { provider: 'OPENAI', model: 'gpt-4o', costType: 'INPUT_TOKEN', costPerUnit: 2.5 },
  { provider: 'OPENAI', model: 'gpt-4o', costType: 'OUTPUT_TOKEN', costPerUnit: 10 },
  { provider: 'OPENAI', model: 'gpt-4o-mini', costType: 'INPUT_TOKEN', costPerUnit: 0.15 },
  { provider: 'OPENAI', model: 'gpt-4o-mini', costType: 'OUTPUT_TOKEN', costPerUnit: 0.6 },
  { provider: 'OPENAI', model: 'o1', costType: 'INPUT_TOKEN', costPerUnit: 15 },
  { provider: 'OPENAI', model: 'o1', costType: 'OUTPUT_TOKEN', costPerUnit: 60 },
]

async function seedPricing() {
  // Use a single fixed validFrom timestamp so re-seeds don't create duplicates.
  // The unique constraint is (provider, model, costType, validFrom).
  const validFrom = new Date('2025-01-01T00:00:00Z')

  for (const item of PRICING_DATA) {
    await prisma.modelPricing.upsert({
      where: {
        provider_model_costType_validFrom: {
          provider: item.provider,
          model: item.model,
          costType: item.costType,
          validFrom,
        },
      },
      update: { costPerUnit: item.costPerUnit, unitSize: item.unitSize ?? 1_000_000 },
      create: {
        provider: item.provider,
        model: item.model,
        costType: item.costType,
        costPerUnit: item.costPerUnit,
        unitSize: item.unitSize ?? 1_000_000,
        validFrom,
      },
    })
  }
  console.log(`✓ Seeded ${PRICING_DATA.length} ModelPricing rows`)
}

async function seedAdminAccount() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    console.warn('⚠ ADMIN_EMAIL / ADMIN_PASSWORD not set in .env — skipping admin seed')
    return
  }

  const existing = await prisma.account.findUnique({ where: { email } })
  if (existing) {
    console.log(`✓ Admin account ${email} already exists — leaving as-is`)
    return
  }

  // Match the PasswordService config (BE-S1-004): argon2id with OWASP 2024 params.
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  })

  await prisma.account.create({
    data: {
      email,
      passwordHash,
      emailVerified: true, // bootstrap admin doesn't go through verify flow
      name: 'Admin',
      role: 'ADMIN',
      isActive: true,
    },
  })
  console.log(`✓ Created admin account: ${email}`)
}

async function main() {
  console.log('Seeding ai_gateway database...')
  await seedAdminAccount()
  await seedPricing()
  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
