import * as crypto from 'crypto'

/**
 * HMAC-SHA256 signature for webhook payloads. Customers verify by re-computing
 * with their stored secret and comparing in constant time.
 *
 * Header convention (sent on every delivery):
 *   X-Raccoon-Signature: t=<unixSeconds>,v1=<hex>
 *   X-Raccoon-Event:     <event-name>
 *   X-Raccoon-Delivery:  <delivery-id>
 *
 * `t` is the issued-at timestamp; signature payload is `<t>.<rawBody>` (Stripe-style).
 * Customers should reject if t skew > 5 min.
 */
export function signWebhookPayload(
  secret: string,
  rawBody: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { header: string; timestamp: number } {
  const payload = `${timestamp}.${rawBody}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return { header: `t=${timestamp},v1=${sig}`, timestamp }
}

/**
 * Generate a fresh webhook secret. Customers see this exactly once on create.
 * 32 bytes base64url ≈ 43 chars, plenty for HMAC.
 */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`
}
