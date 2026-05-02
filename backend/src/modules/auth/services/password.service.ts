import { Injectable } from '@nestjs/common'
import * as argon2 from 'argon2'

/**
 * Argon2id wrapper using OWASP 2024 recommended params for interactive use.
 * Used for:
 *   - Account password hashing
 *   - ApplicationKey hashing (the full sk-rcn-live-... secret, looked up via keyPrefix)
 *
 * NOT used for RefreshToken — those are 32-byte random strings, sha256 is enough.
 */
@Injectable()
export class PasswordService {
  /** OWASP 2024 baseline: 19 MiB, 2 iterations, 1 parallelism. */
  private static readonly OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  }

  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, PasswordService.OPTIONS)
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext)
    } catch {
      // argon2.verify throws on malformed hash strings; treat as no-match.
      return false
    }
  }
}
