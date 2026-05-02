import { Injectable, OnModuleInit, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { AuditService } from '../audit/audit.service'

/**
 * Custom error thrown by `decrypt()` on tag mismatch / corruption.
 * Callers (gateway service in Sprint 2) should catch this specifically and
 * return a `PROVIDER_KEY_UNAVAILABLE` error instead of a 500.
 */
export class DecryptionError extends Error {
  constructor(public readonly reason: 'TAG_MISMATCH' | 'MALFORMED' | 'WRONG_KEY_VERSION') {
    super(`Decryption failed: ${reason}`)
    this.name = 'DecryptionError'
  }
}

const IV_LENGTH = 12 // GCM standard
const TAG_LENGTH = 16

interface EncryptCtx {
  /** Account this ciphertext belongs to — required for audit attribution. */
  accountId: string
  /** Optional: which UserProviderKey row this belongs to (for audit metadata). */
  keyId?: string
  /** Optional: which provider this key targets (for audit metadata). */
  provider?: string
}

interface DecryptCtx extends EncryptCtx {
  /** Optional: request ID being processed (for incident forensics). */
  requestId?: string
  /** Optional: model being requested (for usage analytics). */
  model?: string
}

/**
 * Prisma's `Bytes` column type maps to `Uint8Array<ArrayBuffer>` (= `ReturnType<Uint8Array['slice']>`).
 * Buffer.concat() returns `Buffer<ArrayBufferLike>` which is structurally compatible at runtime
 * but doesn't match Prisma's narrower generic in strict TS mode. We use the helper `toBytes()`
 * below to bridge the two safely.
 */
type Bytes = ReturnType<Uint8Array['slice']>

interface EncryptResult {
  /** [12B IV][16B AuthTag][N B ciphertext]. Stored as Bytes in user_provider_keys.encrypted_key. */
  ciphertext: Bytes
  /** The masterek version used. Persisted alongside ciphertext for rotation. */
  encryptionKeyId: string
}

/**
 * EncryptionService — AES-256-GCM envelope encryption for BYOK provider keys.
 *
 * One master key, configured via env. Each encrypt() generates a fresh 12-byte
 * random IV and produces a self-contained ciphertext blob:
 *
 *     [12B IV][16B AuthTag][N B ciphertext]
 *
 * The plaintext provider key is NEVER logged or persisted. Audit log captures
 * the operation (encrypt/decrypt/decryption_failed) plus metadata (keyId,
 * provider, requestId, model) — never the plaintext.
 *
 * Master key rotation: each row stores the `encryptionKeyId` (e.g. "v1") it was
 * encrypted under. To rotate, add a new master key version under a new ID,
 * keep the old one around as a secondary, and lazy-re-encrypt rows on next
 * decrypt. Rotation worker is post-MVP (D-010 retention plan).
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private masterKeys = new Map<string, Buffer>()
  private currentKeyId!: string

  constructor(
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  onModuleInit(): void {
    const masterB64 = this.config.get<string>('MASTER_ENCRYPTION_KEY')
    const keyId = this.config.get<string>('MASTER_KEY_ID') ?? 'v1'

    if (!masterB64) {
      throw new Error(
        'MASTER_ENCRYPTION_KEY env is required. Generate with: openssl rand -base64 32',
      )
    }
    const buf = Buffer.from(masterB64, 'base64')
    if (buf.length !== 32) {
      throw new Error(
        `MASTER_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). Generate with: openssl rand -base64 32`,
      )
    }
    this.masterKeys.set(keyId, buf)
    this.currentKeyId = keyId

    // TODO(rotation): support a comma-separated MASTER_ENCRYPTION_KEY_PRIOR
    // env that loads previous keys for decrypt-only fallback.
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async encrypt(plaintext: string, ctx: EncryptCtx): Promise<EncryptResult> {
    const key = this.masterKeys.get(this.currentKeyId)
    if (!key) {
      throw new InternalServerErrorException({
        errorCode: 'ENCRYPTION_KEY_UNAVAILABLE',
        message: 'No encryption key loaded.',
      })
    }

    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()

    const ciphertext = toBytes(Buffer.concat([iv, tag, enc]))

    // Audit AFTER successful encrypt. Background flush — encrypt is hot path
    // (provider key creation) but not blocking critical.
    this.audit.logBackground({
      accountId: ctx.accountId,
      actorType: 'SYSTEM',
      action: 'provider_key.encrypted',
      resource: ctx.keyId ? `provider_key:${ctx.keyId}` : null,
      metadata: {
        encryptionKeyId: this.currentKeyId,
        provider: ctx.provider,
      },
    })

    return { ciphertext, encryptionKeyId: this.currentKeyId }
  }

  async decrypt(
    ciphertext: Uint8Array | Buffer,
    encryptionKeyId: string,
    ctx: DecryptCtx,
  ): Promise<string> {
    const key = this.masterKeys.get(encryptionKeyId)
    if (!key) {
      this.audit.logBackground({
        accountId: ctx.accountId,
        actorType: 'SYSTEM',
        action: 'provider_key.decryption_failed',
        resource: ctx.keyId ? `provider_key:${ctx.keyId}` : null,
        metadata: {
          encryptionKeyId,
          reason: 'WRONG_KEY_VERSION',
          requestId: ctx.requestId,
        },
      })
      throw new DecryptionError('WRONG_KEY_VERSION')
    }

    if (ciphertext.length < IV_LENGTH + TAG_LENGTH) {
      this.audit.logBackground({
        accountId: ctx.accountId,
        actorType: 'SYSTEM',
        action: 'provider_key.decryption_failed',
        resource: ctx.keyId ? `provider_key:${ctx.keyId}` : null,
        metadata: { reason: 'MALFORMED', requestId: ctx.requestId },
      })
      throw new DecryptionError('MALFORMED')
    }

    // Wrap as Buffer for crypto API ergonomics (subarray semantics differ
    // slightly between Uint8Array and Buffer for typed-array views).
    const buf = Buffer.from(ciphertext)
    const iv = buf.subarray(0, IV_LENGTH)
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
    const enc = buf.subarray(IV_LENGTH + TAG_LENGTH)

    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')

      // Hot path — fire-and-forget audit. Per D-010 (full audit on BYOK).
      this.audit.logBackground({
        accountId: ctx.accountId,
        actorType: 'SYSTEM',
        action: 'provider_key.decrypted',
        resource: ctx.keyId ? `provider_key:${ctx.keyId}` : null,
        metadata: {
          encryptionKeyId,
          provider: ctx.provider,
          requestId: ctx.requestId,
          model: ctx.model,
        },
      })

      return plaintext
    } catch (err) {
      // Tag mismatch = tampering or corruption. NEVER include plaintext or key
      // material in metadata, even on failure.
      this.audit.logBackground({
        accountId: ctx.accountId,
        actorType: 'SYSTEM',
        action: 'provider_key.decryption_failed',
        resource: ctx.keyId ? `provider_key:${ctx.keyId}` : null,
        metadata: {
          encryptionKeyId,
          reason: 'TAG_MISMATCH',
          requestId: ctx.requestId,
          errorName: err instanceof Error ? err.name : 'UnknownError',
        },
      })
      throw new DecryptionError('TAG_MISMATCH')
    }
  }

  /** Returns the current master key version ID — for new encrypt() callers. */
  getCurrentKeyId(): string {
    return this.currentKeyId
  }
}

/**
 * Convert a Buffer to the precise `Uint8Array<ArrayBuffer>` shape that Prisma's
 * `Bytes` columns expect. `Uint8Array.prototype.slice()` returns a fresh,
 * non-shared ArrayBuffer-backed view — same bytes, narrower generic.
 */
function toBytes(buf: Buffer): Bytes {
  return buf.slice(0, buf.length)
}
