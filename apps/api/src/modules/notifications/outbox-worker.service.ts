import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AppConfig } from '../../config/configuration';

const POLL_INTERVAL_MS = 1000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;
// A row claimed (moved to PROCESSING) but never resolved within this window
// means the process that claimed it died mid-flight (crash, forced restart)
// - nothing else ever un-sticks it otherwise, since PROCESSING->terminal is
// only ever written by the same code path that did the claim.
const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000;

/** Exponential backoff in seconds, indexed by attempt count (1-based). */
const BACKOFF_SECONDS = [1, 5, 30, 120, 600];

/**
 * §12/§32 - the outbox "worker" side. This codebase has no queue library
 * and no application code using the Redis container already present in
 * docker-compose.yml (confirmed by this phase's own audit) - rather than
 * add a new external runtime dependency, this is a plain polling loop
 * reusing the SAME atomic-conditional-claim idiom every other
 * concurrency-sensitive operation in this codebase already uses (see
 * OrderStatusService/InventoryService/CouponRedemptionService): claiming a
 * row is a `updateMany({where: {id, status: 'PENDING'}})` whose `count`
 * tells the caller whether IT won the claim - so N concurrent ticks (or a
 * future multi-instance deployment) processing the same due batch can only
 * ever have one of them actually process any given row (§35's "10 workers,
 * same event, same idempotency key -> 1 logical notification" requirement
 * holds even before NotificationService's own idempotencyKey uniqueness is
 * considered - two independent layers of protection).
 *
 * Runs in-process via setInterval, guarded against overlapping ticks by
 * `isRunning` - survives worker/process restarts because the durable state
 * lives entirely in the OutboxEvent table, never in memory (§32).
 *
 * Phase 13 hardening: the ENTIRE tick body is now wrapped in try/catch -
 * previously only the per-event dispatch was guarded, so a thrown error from
 * `findMany`/the claim `updateMany`/`handleFailure`'s own writes (e.g. a
 * transient DB disconnect) would surface as an unhandled promise rejection
 * from the un-awaited `void this.processBatchOnce()` interval callback,
 * which under Node's default `--unhandled-rejections=throw` crashes the
 * entire process, not just this worker (§58 - "workers must not silently
 * die"). Also adds stale-PROCESSING recovery (§59): a row stuck in
 * PROCESSING past `STALE_PROCESSING_THRESHOLD_MS` (a worker crashed after
 * claiming it, before it could resolve) is reclaimed back to PENDING with
 * its attempt count incremented, so it re-enters the normal
 * retry/backoff/dead-letter path instead of being stuck forever.
 */
@Injectable()
export class OutboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly metrics: MetricsService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit() {
    // Never auto-poll in the e2e test environment (NODE_ENV=test, set by
    // Jest itself) - every e2e test file boots a full AppModule instance,
    // so an ambient background tick racing a test's own explicit
    // processBatchOnce() call could see `isRunning` already true and
    // silently skip, making "drain now, then assert" tests intermittently
    // flaky through no fault of the assertion itself. Tests drive both
    // workers deterministically via their own processBatchOnce() call
    // instead - this never affects real deployments, which never run with
    // NODE_ENV=test.
    if (process.env.NODE_ENV === 'test') return;
    // §14 - ENABLE_WORKERS=false lets ops designate exactly one instance to
    // run pollers in a future multi-instance deployment, without touching
    // code. Defaults true (correct today, since only one process exists).
    if (!this.configService.get('workers', { infer: true }).enabled) {
      this.logger.log('Outbox worker polling disabled via ENABLE_WORKERS=false');
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

      const due = await this.prisma.outboxEvent.findMany({
        where: { status: 'PENDING', availableAt: { lte: new Date() } },
        orderBy: { availableAt: 'asc' },
        take: BATCH_SIZE,
      });

      let processed = 0;
      for (const event of due) {
        const claim = await this.prisma.outboxEvent.updateMany({ where: { id: event.id, status: 'PENDING' }, data: { status: 'PROCESSING' } });
        if (claim.count === 0) continue; // another tick/worker already claimed it.

        try {
          await this.notificationService.dispatchFromOutboxEvent(event);
          await this.prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
          processed += 1;
        } catch (error) {
          await this.handleFailure(event.id, event.attempts, error);
        }
      }
      return processed;
    } catch (error) {
      this.logger.error(`Outbox worker tick failed: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }

  private async recoverStaleProcessing(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS);
    const stale = await this.prisma.outboxEvent.findMany({
      where: { status: 'PROCESSING', updatedAt: { lt: staleBefore } },
      select: { id: true, attempts: true },
    });
    for (const event of stale) {
      await this.handleFailure(event.id, event.attempts, new Error('Reclaimed from stale PROCESSING state (worker likely crashed mid-flight)'));
    }
  }

  private async handleFailure(id: string, previousAttempts: number, error: unknown): Promise<void> {
    const attempts = previousAttempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.outboxEvent.update({ where: { id }, data: { status: 'FAILED', attempts, lastError: message } });
      this.logger.error(`OutboxEvent ${id} permanently failed after ${attempts} attempts: ${message}`);
      this.metrics.incrementCounter('outbox_failed_total');
      return;
    }
    const backoffSeconds = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PENDING', attempts, lastError: message, availableAt: new Date(Date.now() + backoffSeconds * 1000) },
    });
  }
}
