import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OutboxService } from '../notifications/outbox.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ReturnEligibilityService } from './return-eligibility.service';
import { RefundCalculationService } from './refund-calculation.service';
import { CreateReturnRequestDto } from './dto/create-return-request.dto';
import { QueryReturnsDto } from './dto/query-returns.dto';

const RETURN_ITEM_INCLUDE = {
  orderItem: { select: { id: true, productNameSnapshot: true, variantNameSnapshot: true, skuSnapshot: true, unitPrice: true, quantity: true, currency: true } },
} satisfies Prisma.ReturnItemInclude;

const RETURN_REQUEST_INCLUDE = {
  items: { include: RETURN_ITEM_INCLUDE },
  evidence: true,
  // Explicit descending order (never rely on incidental insertion order) -
  // matches AdminReturnsService's own include, so "the current refund" is
  // unambiguously items[0] for both the customer and admin APIs, even once
  // a return has more than one attempt (e.g. after a FAILED retry).
  refunds: { orderBy: { createdAt: 'desc' } },
  order: { select: { id: true, orderNumber: true, currency: true } },
} satisfies Prisma.ReturnRequestInclude;

/**
 * §28/§29 - customer-facing return request lifecycle: create, list, one,
 * cancel. Everything admin-side (approve/reject/receive/inspect/refund)
 * lives in ReturnStatusService/RefundService instead - this service never
 * transitions a return past REQUESTED/CANCELLED.
 */
@Injectable()
export class ReturnRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly outboxService: OutboxService,
    private readonly eligibilityService: ReturnEligibilityService,
    private readonly refundCalculation: RefundCalculationService,
  ) {}

  async create(storeId: string, actor: AuthenticatedUser, dto: CreateReturnRequestDto) {
    const eligibility = await this.eligibilityService.checkOrderEligibility(storeId, dto.orderNumber, actor.userId);
    if (!eligibility.eligible) {
      throw new ConflictException(eligibility.reason ?? 'This order is not eligible for return');
    }

    const order = await this.prisma.order.findFirstOrThrow({ where: { storeId, orderNumber: dto.orderNumber, userId: actor.userId } });
    const eligibleByItemId = new Map(eligibility.items.map((i) => [i.orderItemId, i]));

    for (const requested of dto.items) {
      const eligibleItem = eligibleByItemId.get(requested.orderItemId);
      if (!eligibleItem) {
        throw new BadRequestException(`Order item ${requested.orderItemId} does not belong to this order`);
      }
      if (requested.quantity > eligibleItem.maxReturnableQuantity) {
        throw new BadRequestException(
          `Cannot return ${requested.quantity} of "${eligibleItem.productNameSnapshot}" - only ${eligibleItem.maxReturnableQuantity} remain returnable`,
        );
      }
    }

    // §9 - concurrency-safe re-validation. Two simultaneous create() calls
    // for the SAME order both pass the checks above (read outside any lock),
    // then both reach here - the advisory lock serializes them so the
    // SECOND one re-reads already-returned quantities AFTER the first one's
    // transaction has committed, never both succeeding against a stale view.
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`return:order:${order.id}`}))`;

      for (const requested of dto.items) {
        const orderItem = await tx.orderItem.findUniqueOrThrow({ where: { id: requested.orderItemId } });
        const alreadyReturned = await tx.returnItem.aggregate({
          where: {
            orderItemId: requested.orderItemId,
            returnRequest: { status: { notIn: ['REJECTED', 'CANCELLED'] } },
          },
          _sum: { quantity: true },
        });
        const maxReturnable = orderItem.quantity - (alreadyReturned._sum.quantity ?? 0);
        if (requested.quantity > maxReturnable) {
          throw new ConflictException(`Cannot return ${requested.quantity} of "${orderItem.productNameSnapshot}" - only ${maxReturnable} remain returnable (concurrent return request detected)`);
        }
      }

      const returnRequest = await tx.returnRequest.create({
        data: {
          storeId,
          orderId: order.id,
          userId: actor.userId,
          reason: dto.reason,
          customerComment: dto.customerComment,
        },
      });

      for (const requested of dto.items) {
        const orderItem = await tx.orderItem.findUniqueOrThrow({ where: { id: requested.orderItemId } });
        const refundAmount = this.refundCalculation.calculateItemRefund(order, orderItem, requested.quantity);
        await tx.returnItem.create({
          data: {
            storeId,
            returnRequestId: returnRequest.id,
            orderItemId: requested.orderItemId,
            quantity: requested.quantity,
            reason: requested.reason ?? dto.reason,
            refundAmount,
          },
        });
      }

      await this.outboxService.record(tx, {
        storeId,
        eventType: 'RETURN_REQUESTED',
        aggregateType: 'ReturnRequest',
        aggregateId: returnRequest.id,
        idempotencyKey: `RETURN_REQUESTED:${returnRequest.id}`,
        payload: {
          userId: actor.userId,
          returnId: returnRequest.id,
          orderNumber: order.orderNumber,
          customerName: (order.billingAddress as { fullName?: string } | null)?.fullName ?? order.customerEmail,
        },
      });

      return returnRequest;
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'RETURN_REQUESTED',
      entityType: 'ReturnRequest',
      entityId: created.id,
      metadata: { orderNumber: order.orderNumber, items: dto.items },
    });

    return this.findOneForCustomer(storeId, actor.userId, created.id);
  }

  async findAllForCustomer(storeId: string, userId: string, query: QueryReturnsDto) {
    const where: Prisma.ReturnRequestWhereInput = { storeId, userId, ...(query.status ? { status: query.status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        include: RETURN_REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findOneForCustomer(storeId: string, userId: string, id: string) {
    const returnRequest = await this.prisma.returnRequest.findFirst({ where: { id, storeId, userId }, include: RETURN_REQUEST_INCLUDE });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }
    return returnRequest;
  }

  /** §28 - customer self-service cancel, only while the return has not yet been acted on by an admin (mirrors OrderStatusService's own customer-cancellable-window restriction). */
  async cancel(storeId: string, userId: string, id: string) {
    const existing = await this.findOneForCustomer(storeId, userId, id);
    if (existing.status !== 'REQUESTED' && existing.status !== 'UNDER_REVIEW') {
      throw new ForbiddenException(`This return can no longer be cancelled - it is already ${existing.status}`);
    }

    const result = await this.prisma.returnRequest.updateMany({
      where: { id, storeId, userId, status: existing.status },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (result.count === 0) {
      throw new ConflictException('This return was modified concurrently - please refresh and try again');
    }

    await this.auditLogService.record({ storeId, userId, action: 'RETURN_CANCELLED', entityType: 'ReturnRequest', entityId: id });

    return this.findOneForCustomer(storeId, userId, id);
  }
}
