import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReturnStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OutboxService } from '../notifications/outbox.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ApproveReturnDto } from './dto/approve-return.dto';
import { RejectReturnDto } from './dto/reject-return.dto';
import { InspectReturnDto } from './dto/inspect-return.dto';

/**
 * §6/§30/§33 - the ONE place every admin-side ReturnRequest status change
 * passes through, mirroring OrderStatusService's own centralization
 * philosophy exactly. Never allows an arbitrary status jump - each method
 * enforces its own specific `fromStatus -> toStatus` guard via an atomic
 * conditional `updateMany`, the same idiom used everywhere else in this
 * codebase for exactly-once, race-safe transitions.
 */
@Injectable()
export class ReturnStatusService {
  private static readonly GENERIC_TRANSITIONS: Partial<Record<ReturnStatus, ReturnStatus[]>> = {
    REQUESTED: ['UNDER_REVIEW'],
    APPROVED: ['IN_TRANSIT'],
  };

  /** Mirrors PaymentService/RefundService's own buildOrderNotificationPayload. */
  private async buildNotificationPayload(orderId: string): Promise<{ orderNumber: string; customerName: string }> {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { orderNumber: true, customerEmail: true, billingAddress: true } });
    const billing = order.billingAddress as { fullName?: string } | null;
    return { orderNumber: order.orderNumber, customerName: billing?.fullName ?? order.customerEmail };
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly outboxService: OutboxService,
    private readonly inventoryService: InventoryService,
  ) {}

  /** Simple, side-effect-free transitions only (§30's "use the existing state-machine service rather than exposing arbitrary status manipulation"). */
  async transition(storeId: string, actor: AuthenticatedUser, id: string, targetStatus: ReturnStatus) {
    const existing = await this.getScopedOrThrow(storeId, id);
    const allowed = ReturnStatusService.GENERIC_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(targetStatus)) {
      throw new ConflictException(`Cannot transition a return from ${existing.status} to ${targetStatus}`);
    }

    const result = await this.prisma.returnRequest.updateMany({
      where: { id, storeId, status: existing.status },
      data: { status: targetStatus, ...(targetStatus === 'IN_TRANSIT' ? { inTransitAt: new Date() } : {}) },
    });
    if (result.count === 0) {
      throw new ConflictException('This return was modified concurrently - please refresh and try again');
    }

    await this.auditLogService.record({ storeId, userId: actor.userId, action: `RETURN_${targetStatus}`, entityType: 'ReturnRequest', entityId: id, metadata: { previousStatus: existing.status } });

    return this.getScopedOrThrow(storeId, id);
  }

  async approve(storeId: string, actor: AuthenticatedUser, id: string, dto: ApproveReturnDto) {
    const existing = await this.getScopedOrThrow(storeId, id);
    if (existing.status !== 'REQUESTED' && existing.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot approve a return with status ${existing.status}`);
    }
    const notificationFields = await this.buildNotificationPayload(existing.orderId);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.returnRequest.updateMany({
        where: { id, storeId, status: existing.status },
        data: { status: 'APPROVED', approvedAt: new Date(), adminComment: dto.adminComment },
      });
      if (result.count === 0) {
        throw new ConflictException('This return was modified concurrently - please refresh and try again');
      }
      await this.emitEvent(tx, storeId, id, existing.userId, 'RETURN_APPROVED', notificationFields);
    });

    await this.auditLogService.record({ storeId, userId: actor.userId, action: 'RETURN_APPROVED', entityType: 'ReturnRequest', entityId: id, metadata: { adminComment: dto.adminComment } });

    return this.getScopedOrThrow(storeId, id);
  }

  async reject(storeId: string, actor: AuthenticatedUser, id: string, dto: RejectReturnDto) {
    const existing = await this.getScopedOrThrow(storeId, id);
    if (existing.status !== 'REQUESTED' && existing.status !== 'UNDER_REVIEW') {
      throw new ConflictException(`Cannot reject a return with status ${existing.status}`);
    }
    const notificationFields = await this.buildNotificationPayload(existing.orderId);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.returnRequest.updateMany({
        where: { id, storeId, status: existing.status },
        data: { status: 'REJECTED', rejectedAt: new Date(), adminComment: dto.adminComment },
      });
      if (result.count === 0) {
        throw new ConflictException('This return was modified concurrently - please refresh and try again');
      }
      await this.emitEvent(tx, storeId, id, existing.userId, 'RETURN_REJECTED', notificationFields);
    });

    await this.auditLogService.record({ storeId, userId: actor.userId, action: 'RETURN_REJECTED', entityType: 'ReturnRequest', entityId: id, metadata: { adminComment: dto.adminComment } });

    return this.getScopedOrThrow(storeId, id);
  }

  /** §33 "Mark Received" - accepts from APPROVED or IN_TRANSIT, so a merchant that never bothered with the optional in-transit marker can still record receipt directly. */
  async markReceived(storeId: string, actor: AuthenticatedUser, id: string) {
    const existing = await this.getScopedOrThrow(storeId, id);
    if (existing.status !== 'APPROVED' && existing.status !== 'IN_TRANSIT') {
      throw new ConflictException(`Cannot mark received a return with status ${existing.status}`);
    }
    const notificationFields = await this.buildNotificationPayload(existing.orderId);

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.returnRequest.updateMany({
        where: { id, storeId, status: existing.status },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      });
      if (result.count === 0) {
        throw new ConflictException('This return was modified concurrently - please refresh and try again');
      }
      await this.emitEvent(tx, storeId, id, existing.userId, 'RETURN_RECEIVED', notificationFields);
    });

    await this.auditLogService.record({ storeId, userId: actor.userId, action: 'RETURN_RECEIVED', entityType: 'ReturnRequest', entityId: id });

    return this.getScopedOrThrow(storeId, id);
  }

  /**
   * §13/§14/§15/§30/§45 - records item condition + disposition for every
   * ReturnItem in one atomic transaction, and physically restocks (via
   * InventoryService.restockFromReturn, NEVER by touching InventoryItem
   * directly) exactly the items disposed RESTOCK. RECEIVED -> REFUND_PENDING
   * only once every ReturnItem has been inspected.
   */
  async inspect(storeId: string, actor: AuthenticatedUser, id: string, dto: InspectReturnDto) {
    const existing = await this.prisma.returnRequest.findFirst({ where: { id, storeId }, include: { items: true } });
    if (!existing) {
      throw new NotFoundException('Return request not found');
    }
    if (existing.status !== 'RECEIVED') {
      throw new ConflictException(`Cannot inspect a return with status ${existing.status}`);
    }

    const itemIds = new Set(existing.items.map((i) => i.id));
    const submittedIds = new Set(dto.items.map((i) => i.returnItemId));
    for (const item of dto.items) {
      if (!itemIds.has(item.returnItemId)) {
        throw new NotFoundException(`Return item ${item.returnItemId} does not belong to this return`);
      }
    }
    if (submittedIds.size !== itemIds.size) {
      throw new ConflictException('Every item on this return must be inspected together');
    }

    await this.prisma.$transaction(async (tx) => {
      const transitioned = await tx.returnRequest.updateMany({ where: { id, storeId, status: 'RECEIVED' }, data: { status: 'REFUND_PENDING', inspectedAt: new Date() } });
      if (transitioned.count === 0) {
        throw new ConflictException('This return was modified concurrently - please refresh and try again');
      }

      for (const submitted of dto.items) {
        await tx.returnItem.update({
          where: { id: submitted.returnItemId },
          data: { itemCondition: submitted.itemCondition, disposition: submitted.disposition },
        });

        if (submitted.disposition === 'RESTOCK') {
          const returnItem = await tx.returnItem.findUniqueOrThrow({ where: { id: submitted.returnItemId } });
          // §15 - the atomic idempotency claim: only a caller that wins this
          // conditional update ever physically restocks. A duplicate
          // inspect() submission (retried request, concurrent admin double-
          // click) can never restock the same ReturnItem twice, because the
          // second attempt sees count===0 and is a silent no-op here.
          const claim = await tx.returnItem.updateMany({ where: { id: submitted.returnItemId, restockedAt: null }, data: { restockedAt: new Date() } });
          if (claim.count === 0) continue;

          const reservation = await tx.stockReservation.findFirst({ where: { orderItemId: returnItem.orderItemId }, orderBy: { createdAt: 'desc' } });
          if (!reservation) continue; // defensive only - every fulfilled order line has a reservation.
          await this.inventoryService.restockFromReturn(storeId, reservation.inventoryItemId, returnItem.quantity, `return:${id}`, actor, tx);
        }
      }
    });

    await this.auditLogService.record({ storeId, userId: actor.userId, action: 'RETURN_INSPECTED', entityType: 'ReturnRequest', entityId: id, metadata: { items: dto.items } });

    return this.getScopedOrThrow(storeId, id);
  }

  async getScopedOrThrow(storeId: string, id: string) {
    const existing = await this.prisma.returnRequest.findFirst({ where: { id, storeId } });
    if (!existing) {
      throw new NotFoundException('Return request not found');
    }
    return existing;
  }

  private async emitEvent(
    tx: Prisma.TransactionClient,
    storeId: string,
    returnRequestId: string,
    userId: string,
    eventType: string,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.outboxService.record(tx, {
      storeId,
      eventType,
      aggregateType: 'ReturnRequest',
      aggregateId: returnRequestId,
      idempotencyKey: `${eventType}:${returnRequestId}`,
      payload: { userId, returnId: returnRequestId, ...extra },
    });
  }
}
