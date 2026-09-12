import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, NotificationPreferenceKey, NotificationType, OutboxEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationTemplateService } from './notification-template.service';
import { TemplateRendererService } from './template-renderer.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { QueryAdminNotificationsDto } from './dto/query-admin-notifications.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

/**
 * §13-§16 - types whose corresponding preference key, for both channels.
 * Deliberately splits "order updates" from "shipping updates" (matching the
 * distinct EMAIL_SHIPPING_UPDATES/IN_APP_SHIPPING_UPDATES preference keys
 * §6 asks for) rather than lumping the whole order lifecycle under one key.
 */
const TYPE_PREFERENCE_CATEGORY: Record<NotificationType, 'ORDER' | 'SHIPPING' | 'PAYMENT' | 'REVIEW' | 'PROMOTION'> = {
  ORDER_CONFIRMED: 'ORDER',
  ORDER_CANCELLED: 'ORDER',
  ORDER_PACKED: 'ORDER',
  ORDER_SHIPPED: 'SHIPPING',
  ORDER_DELIVERED: 'SHIPPING',
  PAYMENT_SUCCESS: 'PAYMENT',
  PAYMENT_FAILED: 'PAYMENT',
  REVIEW_APPROVED: 'REVIEW',
  REVIEW_REJECTED: 'REVIEW',
  PROMOTION_AVAILABLE: 'PROMOTION',
  COUPON_AVAILABLE: 'PROMOTION',
  // Phase 10 - a return is an order-lifecycle event; a refund is a
  // payment-lifecycle event. Reuses the existing categories rather than
  // adding new preference keys, exactly like Phase 9's own SHIPPING/ORDER
  // split reused existing infrastructure instead of inventing more.
  RETURN_REQUESTED: 'ORDER',
  RETURN_APPROVED: 'ORDER',
  RETURN_REJECTED: 'ORDER',
  RETURN_RECEIVED: 'ORDER',
  REFUND_INITIATED: 'PAYMENT',
  REFUND_SUCCEEDED: 'PAYMENT',
  REFUND_FAILED: 'PAYMENT',
};

/**
 * §6 - these types are "legally/operationally necessary transactional
 * communication" and are NEVER suppressed by a notification preference,
 * regardless of channel: a payment failure, an order cancellation, and
 * (Phase 10) a refund failure are exactly the kind of thing a customer must
 * be able to find out about even if they've turned off "order updates"
 * emails for convenience. Every other transactional type (confirmations,
 * packed/shipped/delivered progress, payment/refund success, review
 * moderation outcomes, return status updates) legitimately respects the
 * customer's own preference - see this file's class doc comment for the
 * full rationale, documented in the Phase 9 report.
 */
const ALWAYS_SEND_TYPES: NotificationType[] = ['PAYMENT_FAILED', 'ORDER_CANCELLED', 'REFUND_FAILED'];

interface EventPayload {
  userId: string;
  [key: string]: unknown;
}

/**
 * §8 - the central service business modules never bypass. Business modules
 * only ever emit an OutboxEvent (via OutboxService, inside their own
 * transaction) - they never call this service directly and never implement
 * SMTP logic themselves (§8's own explicit decoupling requirement).
 * OutboxWorkerService is the only caller of dispatchFromOutboxEvent(); the
 * customer/admin controllers are the only callers of everything else.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly templateService: NotificationTemplateService,
    private readonly renderer: TemplateRendererService,
  ) {}

  /**
   * Maps one durable OutboxEvent into concrete Notification row(s) - IN_APP
   * always (its own preference key still gates it, ALWAYS_SEND_TYPES
   * bypasses that), EMAIL only when enabled by preference/ALWAYS_SEND. Each
   * row's idempotencyKey is "<eventType>:<aggregateId>:<channel>" - a
   * duplicate dispatch of the same OutboxEvent (worker retry, concurrent
   * worker claiming the same logical event through some future change) can
   * only ever hit the unique constraint, never create a second logical
   * notification for the same recipient+channel.
   */
  async dispatchFromOutboxEvent(event: OutboxEvent): Promise<void> {
    const type = event.eventType as NotificationType;
    const payload = event.payload as unknown as EventPayload;
    if (!payload?.userId) {
      this.logger.warn(`OutboxEvent ${event.id} (${event.eventType}) has no userId in its payload - skipping`);
      return;
    }

    const category = TYPE_PREFERENCE_CATEGORY[type];
    const alwaysSend = ALWAYS_SEND_TYPES.includes(type);

    const wantsInApp = alwaysSend || (await this.preferenceService.isEnabled(event.storeId, payload.userId, `IN_APP_${category}_UPDATES` as NotificationPreferenceKey));
    if (wantsInApp) {
      await this.createNotification(event.storeId, payload.userId, type, 'IN_APP', event, payload);
    }

    const wantsEmail = alwaysSend || (await this.preferenceService.isEnabled(event.storeId, payload.userId, `EMAIL_${category}_UPDATES` as NotificationPreferenceKey));
    if (wantsEmail) {
      await this.createNotification(event.storeId, payload.userId, type, 'EMAIL', event, payload);
    }
  }

  private async createNotification(
    storeId: string,
    userId: string,
    type: NotificationType,
    channel: NotificationChannel,
    event: OutboxEvent,
    variables: Record<string, unknown>,
  ): Promise<void> {
    const template = await this.templateService.getEffective(storeId, type, channel);
    const stringVars: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined && value !== null) stringVars[key] = String(value);
    }
    const title = this.renderer.render(template.title, stringVars);
    const message = this.renderer.render(template.body, stringVars);

    try {
      await this.prisma.notification.create({
        data: {
          storeId,
          userId,
          type,
          channel,
          title,
          message,
          data: event.payload as Prisma.InputJsonValue,
          idempotencyKey: `${event.eventType}:${event.aggregateId}:${channel}`,
          // IN_APP delivery IS the row existing - there is no further
          // delivery step, so it's created already SENT. EMAIL is left
          // PENDING for EmailDeliveryWorkerService to actually send.
          status: channel === 'IN_APP' ? 'SENT' : 'PENDING',
          sentAt: channel === 'IN_APP' ? new Date() : null,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      // Already dispatched for this event+channel - safe no-op (§17).
    }
  }

  async getUserNotifications(storeId: string, userId: string, query: QueryNotificationsDto) {
    const where: Prisma.NotificationWhereInput = { storeId, userId };
    if (query.unreadOnly) where.readAt = null;
    if (query.type) where.type = query.type;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getUnreadCount(storeId: string, userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({ where: { storeId, userId, readAt: null } });
    return { count };
  }

  async markAsRead(storeId: string, userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, storeId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      // Never reveals whether the id belongs to another customer, was
      // already read, or simply doesn't exist (§20's tenant-isolation
      // requirement) - a safe, idempotent no-op look-alike either way,
      // except a genuinely nonexistent/foreign id gets a 404.
      const exists = await this.prisma.notification.findFirst({ where: { id, storeId, userId } });
      if (!exists) throw new NotFoundException('Notification not found');
    }
    return { id };
  }

  async markAllAsRead(storeId: string, userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { storeId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  /** §22 - admin visibility, scoped to the admin's OWN store only - never a cross-tenant leak (§28). */
  async findAllForAdmin(storeId: string, query: QueryAdminNotificationsDto) {
    const where: Prisma.NotificationWhereInput = { storeId };
    if (query.userId) where.userId = query.userId;
    if (query.channel) where.channel = query.channel;
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.fromDate || query.toDate) {
      where.createdAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findOneForAdmin(storeId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, storeId },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
}
