import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationTemplateService } from './notification-template.service';
import { TemplateRendererService } from './template-renderer.service';
import { EmailProvider } from './providers/email-provider.interface';
import { EMAIL_PROVIDER } from './providers/email-provider.tokens';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AppConfig } from '../../config/configuration';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 20;
// §18 - immediate / short delay / longer delay / final retry, exponential.
const MAX_ATTEMPTS = 4;
const BACKOFF_SECONDS = [5, 30, 120];
// See OutboxWorkerService's identical constant/rationale for stale-PROCESSING recovery.
const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * §18/§19 - actual EMAIL delivery, decoupled from outbox processing so a
 * slow/unavailable SMTP provider never blocks in-app notification delivery
 * or business-transaction commits (§12). Uses the same atomic-conditional-
 * claim + backoff idiom as OutboxWorkerService. After MAX_ATTEMPTS, a
 * Notification row is left FAILED with attempts/lastError populated -
 * queryable via GET /admin/notifications?status=FAILED (§19's "minimal
 * persistent failed-notification state").
 */
@Injectable()
export class EmailDeliveryWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailDeliveryWorkerService.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: NotificationTemplateService,
    private readonly renderer: TemplateRendererService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly metrics: MetricsService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit() {
    // See OutboxWorkerService's identical guard - never auto-poll under
    // Jest (NODE_ENV=test), so e2e tests drive delivery deterministically
    // via their own processBatchOnce() call instead of racing an ambient
    // background tick. Never affects a real deployment.
    if (process.env.NODE_ENV === 'test') return;
    if (!this.configService.get('workers', { infer: true }).enabled) {
      this.logger.log('Email delivery worker polling disabled via ENABLE_WORKERS=false');
      return;
    }
    this.timer = setInterval(() => void this.processBatchOnce(), POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public so tests can drive the worker deterministically instead of waiting on the real timer. */
  async processBatchOnce(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    try {
      await this.recoverStaleProcessing();

      const due = await this.prisma.notification.findMany({
        where: { channel: 'EMAIL', status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH_SIZE,
      });

      let sent = 0;
      for (const notification of due) {
        const claim = await this.prisma.notification.updateMany({ where: { id: notification.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
        if (claim.count === 0) continue;

        try {
          const user = await this.prisma.user.findUniqueOrThrow({ where: { id: notification.userId }, select: { email: true } });
          const template = await this.templateService.getEffective(notification.storeId, notification.type, 'EMAIL');
          const variables = (notification.data as Record<string, unknown>) ?? {};
          const stringVars: Record<string, string> = {};
          for (const [key, value] of Object.entries(variables)) {
            if (value !== undefined && value !== null) stringVars[key] = String(value);
          }
          await this.emailProvider.send({
            to: user.email,
            subject: this.renderer.render(template.subject ?? template.title, stringVars),
            html: this.renderer.renderHtml(template.body, stringVars),
            text: this.renderer.render(template.body, stringVars),
          });
          await this.prisma.notification.update({ where: { id: notification.id }, data: { status: 'SENT', sentAt: new Date() } });
          sent += 1;
        } catch (error) {
          await this.handleFailure(notification.id, notification.attempts, error);
        }
      }
      return sent;
    } catch (error) {
      this.logger.error(`Email delivery worker tick failed: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  private async recoverStaleProcessing(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS);
    const stale = await this.prisma.notification.findMany({
      where: { channel: 'EMAIL', status: 'PROCESSING', updatedAt: { lt: staleBefore } },
      select: { id: true, attempts: true },
    });
    for (const notification of stale) {
      await this.handleFailure(notification.id, notification.attempts, new Error('Reclaimed from stale PROCESSING state (worker likely crashed mid-flight)'));
    }
  }

  private async handleFailure(id: string, previousAttempts: number, error: unknown): Promise<void> {
    const attempts = previousAttempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.notification.update({ where: { id }, data: { status: 'FAILED', attempts, lastError: message } });
      this.logger.error(`Notification ${id} email delivery permanently failed after ${attempts} attempts: ${message}`);
      this.metrics.incrementCounter('email_delivery_failed_total');
      return;
    }
    const backoffSeconds = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
    await this.prisma.notification.update({
      where: { id },
      data: { status: 'PENDING', attempts, lastError: message, nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000) },
    });
  }
}
