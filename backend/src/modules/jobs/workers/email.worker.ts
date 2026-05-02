import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'

@Processor('email-sending')
export class EmailWorker extends WorkerHost {
  async process(job: Job<{ to: string; template: string; data: Record<string, unknown> }>): Promise<void> {
    const { to, template, data } = job.data

    // Placeholder — full implementation in Phase 7 (Email module)
    // Will use Resend API or SMTP
    console.log(`[EmailWorker] Sending ${template} email to ${to}`, data)

    // TODO: Integrate with EmailsService when built
    // await this.emailsService.sendTemplate(to, template, data)
  }
}
