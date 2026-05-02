import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'

@Injectable()
export class EmailsService {
  private resendApiKey: string
  private fromAddress: string

  constructor(
    config: ConfigService,
    @InjectQueue('email-sending') private emailQueue: Queue,
  ) {
    this.resendApiKey = config.get<string>('RESEND_API_KEY') ?? ''
    this.fromAddress = config.get<string>('EMAIL_FROM') ?? 'AI Gateway <noreply@aigateway.dev>'
  }

  /**
   * Send a verification link to a freshly registered Account.
   * Routed through the queue — user can wait a few seconds.
   */
  async sendVerifyEmail(to: string, name: string | null, verifyUrl: string) {
    const html = renderVerifyEmail(name ?? 'Cześć', verifyUrl)
    await this.emailQueue.add('send', {
      to,
      subject: 'Potwierdź swój adres email — Raccoon AI Gateway',
      html,
    })
  }

  /**
   * Send a password reset link. Routed through the queue.
   * Token expires in 1h on the backend side.
   */
  async sendResetPassword(to: string, resetUrl: string) {
    const html = renderResetPasswordEmail(resetUrl)
    await this.emailQueue.add('send', {
      to,
      subject: 'Resetowanie hasła — Raccoon AI Gateway',
      html,
    })
  }

  // Direct send (bypasses queue — for immediate emails). Used by the queue
  // worker once it's up; called inline as a fallback if the worker is down.
  async sendDirect(to: string, subject: string, html: string) {
    if (!this.resendApiKey) {
      console.log(`[EmailsService] No RESEND_API_KEY configured — skipping email to ${to}`)
      return
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.resendApiKey}`,
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to,
        subject,
        html,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`[EmailsService] Failed to send email: ${response.status}`, error)
      throw new Error(`Email delivery failed: ${response.status}`)
    }

    return response.json()
  }
}

// =============================================================================
// Minimal HTML templates. Replace with proper React Email / MJML in Sprint 4.
// =============================================================================

function renderVerifyEmail(name: string, verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pl">
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 24px; color: #171717;">
  <h1 style="font-size: 20px; margin: 0 0 16px;">Potwierdź swój email</h1>
  <p>${escapeHtml(name)}, dziękujemy za rejestrację w Raccoon AI Gateway.</p>
  <p>Aby aktywować konto, kliknij poniższy link — ważny przez 24 godziny.</p>
  <p style="margin: 32px 0;">
    <a href="${escapeAttr(verifyUrl)}" style="display: inline-block; background: #171717; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Potwierdź email</a>
  </p>
  <p style="color: #737373; font-size: 13px;">Jeśli przycisk nie działa, skopiuj poniższy link do przeglądarki:</p>
  <p style="color: #737373; font-size: 13px; word-break: break-all;">${escapeHtml(verifyUrl)}</p>
  <hr style="border: 0; border-top: 1px solid #e5e5e5; margin: 32px 0;" />
  <p style="color: #a3a3a3; font-size: 12px;">Jeśli to nie Ty zarejestrowałeś się, zignoruj tę wiadomość.</p>
</body>
</html>`
}

function renderResetPasswordEmail(resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pl">
<body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 40px auto; padding: 24px; color: #171717;">
  <h1 style="font-size: 20px; margin: 0 0 16px;">Resetowanie hasła</h1>
  <p>Otrzymaliśmy prośbę o reset hasła do Twojego konta.</p>
  <p>Aby ustawić nowe hasło, kliknij poniższy link — ważny przez 1 godzinę.</p>
  <p style="margin: 32px 0;">
    <a href="${escapeAttr(resetUrl)}" style="display: inline-block; background: #171717; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Ustaw nowe hasło</a>
  </p>
  <p style="color: #737373; font-size: 13px;">Po zmianie hasła wszystkie inne sesje zostaną zakończone.</p>
  <hr style="border: 0; border-top: 1px solid #e5e5e5; margin: 32px 0;" />
  <p style="color: #a3a3a3; font-size: 12px;">Jeśli nie prosiłeś o reset hasła, zignoruj tę wiadomość — nikt nie ma dostępu do Twojego konta dopóki nie kliknie linku.</p>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}
