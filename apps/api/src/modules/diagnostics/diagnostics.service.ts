import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from '../../common/metrics/metrics.service';

@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async getSnapshot(storeId: string) {
    const [outbox, notifications] = await Promise.all([this.outboxBacklog(storeId), this.notificationBacklog(storeId)]);

    return {
      timestamp: new Date().toISOString(),
      outbox,
      notifications,
      metrics: this.metrics.snapshot(),
    };
  }

  private async outboxBacklog(storeId: string) {
    const [pending, processing, failed, oldestPending] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { storeId, status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { storeId, status: 'PROCESSING' } }),
      this.prisma.outboxEvent.count({ where: { storeId, status: 'FAILED' } }),
      this.prisma.outboxEvent.findFirst({ where: { storeId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return this.shape(pending, processing, failed, oldestPending?.createdAt);
  }

  private async notificationBacklog(storeId: string) {
    const [pending, processing, failed, oldestPending] = await Promise.all([
      this.prisma.notification.count({ where: { storeId, status: 'PENDING' } }),
      this.prisma.notification.count({ where: { storeId, status: 'PROCESSING' } }),
      this.prisma.notification.count({ where: { storeId, status: 'FAILED' } }),
      this.prisma.notification.findFirst({ where: { storeId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return this.shape(pending, processing, failed, oldestPending?.createdAt);
  }

  private shape(pending: number, processing: number, failed: number, oldestPendingCreatedAt: Date | undefined) {
    return {
      pending,
      processing,
      failed,
      oldestPendingAgeSeconds: oldestPendingCreatedAt ? Math.round((Date.now() - oldestPendingCreatedAt.getTime()) / 1000) : null,
    };
  }
}
