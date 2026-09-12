import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { InitializeInventoryDto } from './dto/initialize-inventory.dto';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';
import { TransferInventoryDto } from './dto/transfer-inventory.dto';
import { QueryInventoryDto } from './dto/query-inventory.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationExpiredException } from './exceptions/reservation-expired.exception';

/** A system-initiated action (a sweep) has no real HTTP actor - audit entries attribute it to the order's own owning user rather than fabricating one. */
function buildSystemActor(userId: string): AuthenticatedUser {
  return { userId, storeId: '', email: '', type: 'CUSTOMER', roles: [], permissions: [] };
}

const INVENTORY_INCLUDE = {
  warehouse: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, name: true, sku: true, slug: true } },
  variant: { select: { id: true, sku: true } },
} satisfies Prisma.InventoryItemInclude;

/**
 * PHASE 2F CORRECTION - explicit inventory quantity & reservation semantics.
 *
 * Four quantities, each with exactly one meaning:
 *
 *  - onHandQuantity:  physical stock actually in the warehouse. Changed only
 *                     by adjust() and transfer() - never by reserve/release/consume.
 *  - reservedQuantity: total stock currently held out for ANY non-released
 *                     reservation, regardless of whether that reservation's
 *                     status is ACTIVE or COMMITTED. This is "Model B" from
 *                     the two options the correction asked to choose between
 *                     ("only ACTIVE" vs "all stock unavailable due to
 *                     reservations/commitments") - B was chosen specifically
 *                     because it keeps the required invariant
 *                     `availableQuantity = onHandQuantity - reservedQuantity`
 *                     a literal two-term formula, with no third subtraction
 *                     term and no risk of double-counting a reservation's
 *                     quantity in two buckets at once.
 *  - availableQuantity: onHandQuantity - reservedQuantity, always. Maintained
 *                     in the same transaction as whichever side changes.
 *  - committedQuantity: NOT a separate pool subtracted from availability.
 *                     It is a reporting-only SUBSET of reservedQuantity,
 *                     answering "of the total held-out stock, how much is a
 *                     firm allocation (COMMITTED) rather than just a
 *                     temporary hold (ACTIVE)". By construction
 *                     committedQuantity <= reservedQuantity always.
 *
 * Reservation states:
 *  - ACTIVE:     a temporary hold. Included in reservedQuantity. Expiration-
 *                ready (expiresAt is stored) but nothing sweeps it yet - see
 *                Phase 2F report known issues.
 *  - RELEASED:   the hold is gone. Excluded from reservedQuantity (the
 *                quantity was credited back to availableQuantity on release).
 *                Terminal - cannot transition anywhere else.
 *  - COMMITTED:  the hold has become a firm allocation (e.g. a paid order).
 *                STILL included in reservedQuantity (see Model B above) -
 *                nothing moves between onHand/reserved/available on this
 *                transition, only the status changes and committedQuantity's
 *                reporting figure increases. Terminal - cannot be released.
 *                Physically removing the stock from onHand (e.g. at
 *                shipment/fulfillment) is a future phase's job, not this
 *                one's - Checkout/Fulfillment can rely on: a COMMITTED
 *                reservation's units are guaranteed still physically on hand
 *                (onHand is untouched) and guaranteed not sellable to anyone
 *                else (still counted in reservedQuantity).
 *
 * Verified directly against PostgreSQL (not just application responses) in
 * test/inventory.e2e-spec.ts: for every InventoryItem,
 * SUM(StockReservation.quantity WHERE status IN ('ACTIVE','COMMITTED')) ==
 * InventoryItem.reservedQuantity.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ---------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------

  async initialize(storeId: string, dto: InitializeInventoryDto, actor: AuthenticatedUser) {
    await this.getStoreScopedWarehouseOrThrow(storeId, dto.warehouseId);
    await this.validateProductAndVariant(storeId, dto.productId, dto.variantId);

    const itemId = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent first-time-initialization attempts for the exact
      // same (warehouse, product, variant) identity. Needed specifically for
      // SIMPLE products where variantId is NULL and the DB's unique index
      // (@@unique([warehouseId, productId, variantId])) can't stop two
      // simultaneous creates on its own, since Postgres treats every NULL as
      // distinct in a unique index. See Phase 2F report for the full rationale.
      const lockKey = `${dto.warehouseId}:${dto.productId}:${dto.variantId ?? 'simple'}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existing = await tx.inventoryItem.findFirst({
        where: { warehouseId: dto.warehouseId, productId: dto.productId, variantId: dto.variantId ?? null },
      });
      if (existing) {
        throw new ConflictException('Inventory has already been initialized for this SKU in this warehouse');
      }

      const item = await tx.inventoryItem.create({
        data: {
          storeId,
          warehouseId: dto.warehouseId,
          productId: dto.productId,
          variantId: dto.variantId,
          onHandQuantity: dto.quantity,
          availableQuantity: dto.quantity,
          reservedQuantity: 0,
          lowStockThreshold: dto.lowStockThreshold ?? 0,
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: item.id,
          type: 'INITIAL_STOCK',
          quantity: dto.quantity,
          previousQuantity: 0,
          newQuantity: dto.quantity,
          reason: 'Initial stock',
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryInitialized',
        entityType: 'InventoryItem',
        entityId: item.id,
        metadata: { warehouseId: dto.warehouseId, productId: dto.productId, variantId: dto.variantId, quantity: dto.quantity },
      });

      return item.id;
    });

    // Enriched (warehouse/product/variant + isLowStock/isOutOfStock) response,
    // queried only after the transaction above has committed - same rationale
    // as adjust()/transfer().
    return this.findOne(storeId, itemId);
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async findAll(storeId: string, query: QueryInventoryDto) {
    const where: Prisma.InventoryItemWhereInput = {
      storeId,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.outOfStock ? { availableQuantity: { lte: 0 } } : {}),
      ...(query.search
        ? {
            OR: [
              { product: { name: { contains: query.search, mode: 'insensitive' } } },
              { product: { sku: { contains: query.search, mode: 'insensitive' } } },
              { variant: { sku: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rawItems, total] = await this.prisma.$transaction([
      this.prisma.inventoryItem.findMany({
        where,
        include: INVENTORY_INCLUDE,
        orderBy: { [query.sortBy ?? 'updatedAt']: query.sortOrder ?? 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    // lowStock depends on comparing two columns of the same row, which Prisma's
    // query builder can't express in a `where` filter - applied in memory
    // instead, after pagination, over just this page's rows (never the whole table).
    const items = query.lowStock
      ? rawItems.filter((item) => item.availableQuantity <= item.lowStockThreshold)
      : rawItems;

    return paginate(items.map((item) => this.toResponse(item)), total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, storeId },
      include: INVENTORY_INCLUDE,
    });
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }
    return this.toResponse(item);
  }

  /** Append-only movement history for one inventory item - never editable, see Phase 2F report. */
  async findTransactions(storeId: string, id: string, query: PaginationQueryDto) {
    await this.getStoreScopedItemOrThrow(storeId, id);

    const where = { inventoryItemId: id, storeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryTransaction.findMany({
        where,
        include: { performedBy: { select: { id: true, email: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  // ---------------------------------------------------------------------
  // Adjustment
  // ---------------------------------------------------------------------

  async adjust(storeId: string, dto: AdjustInventoryDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedItemOrThrow(storeId, dto.inventoryItemId);

    await this.prisma.$transaction(async (tx) => {
      let result: Prisma.BatchPayload;
      if (dto.quantity < 0) {
        const remove = -dto.quantity;
        // Stock-out is validated against AVAILABLE, not raw on-hand: removing
        // physically-reserved stock without releasing the reservation first
        // would push available below zero, violating the core invariant. If a
        // merchant genuinely needs to remove reserved-but-damaged stock, they
        // release/consume the reservation first, then adjust.
        result = await tx.inventoryItem.updateMany({
          where: { id: dto.inventoryItemId, storeId, availableQuantity: { gte: remove } },
          data: { onHandQuantity: { decrement: remove }, availableQuantity: { decrement: remove } },
        });
      } else {
        result = await tx.inventoryItem.updateMany({
          where: { id: dto.inventoryItemId, storeId },
          data: { onHandQuantity: { increment: dto.quantity }, availableQuantity: { increment: dto.quantity } },
        });
      }

      if (result.count === 0) {
        throw new ConflictException('Insufficient available stock for this adjustment');
      }

      const updated = await tx.inventoryItem.findUniqueOrThrow({ where: { id: dto.inventoryItemId } });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: existing.id,
          type: dto.quantity >= 0 ? 'STOCK_IN' : 'STOCK_OUT',
          quantity: dto.quantity,
          previousQuantity: existing.onHandQuantity,
          newQuantity: updated.onHandQuantity,
          reason: dto.reason,
          reference: dto.reference,
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryAdjusted',
        entityType: 'InventoryItem',
        entityId: existing.id,
        metadata: { quantity: dto.quantity, reason: dto.reason, before: existing.onHandQuantity, after: updated.onHandQuantity },
      });
    });

    // Queried only after the transaction above has actually committed - calling
    // findOne() (which uses the outer, non-transactional Prisma client) from
    // INSIDE the transaction would read via a separate connection that can't
    // see that same transaction's own uncommitted writes yet.
    return this.findOne(storeId, existing.id);
  }

  // ---------------------------------------------------------------------
  // Transfer
  // ---------------------------------------------------------------------

  async transfer(storeId: string, dto: TransferInventoryDto, actor: AuthenticatedUser) {
    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Source and destination warehouse must be different');
    }
    await this.getStoreScopedWarehouseOrThrow(storeId, dto.sourceWarehouseId);
    await this.getStoreScopedWarehouseOrThrow(storeId, dto.destinationWarehouseId);
    await this.validateProductAndVariant(storeId, dto.productId, dto.variantId);

    const reference = `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { sourceId, destId } = await this.prisma.$transaction(async (tx) => {
      const sourceItem = await tx.inventoryItem.findFirst({
        where: { storeId, warehouseId: dto.sourceWarehouseId, productId: dto.productId, variantId: dto.variantId ?? null },
      });
      if (!sourceItem) {
        throw new NotFoundException('No inventory found for this SKU at the source warehouse');
      }

      // Concurrency-safe source decrement: two simultaneous transfers pulling
      // from the same source row serialize on this UPDATE, and the second one
      // re-checks `availableQuantity >= quantity` against the post-first-commit
      // state - exactly the atomic conditional-update pattern used everywhere
      // else in this service.
      const decremented = await tx.inventoryItem.updateMany({
        where: { id: sourceItem.id, availableQuantity: { gte: dto.quantity } },
        data: { onHandQuantity: { decrement: dto.quantity }, availableQuantity: { decrement: dto.quantity } },
      });
      if (decremented.count === 0) {
        throw new ConflictException('Insufficient available stock at the source warehouse to transfer');
      }

      // Same advisory-lock technique as initialize(): serializes concurrent
      // transfers that would otherwise race to create the SAME destination
      // InventoryItem for the first time.
      const lockKey = `${dto.destinationWarehouseId}:${dto.productId}:${dto.variantId ?? 'simple'}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      let destItem = await tx.inventoryItem.findFirst({
        where: { warehouseId: dto.destinationWarehouseId, productId: dto.productId, variantId: dto.variantId ?? null },
      });
      const destPreviousQuantity = destItem?.onHandQuantity ?? 0;
      if (destItem) {
        destItem = await tx.inventoryItem.update({
          where: { id: destItem.id },
          data: { onHandQuantity: { increment: dto.quantity }, availableQuantity: { increment: dto.quantity } },
        });
      } else {
        destItem = await tx.inventoryItem.create({
          data: {
            storeId,
            warehouseId: dto.destinationWarehouseId,
            productId: dto.productId,
            variantId: dto.variantId,
            onHandQuantity: dto.quantity,
            availableQuantity: dto.quantity,
            reservedQuantity: 0,
          },
        });
      }

      const updatedSource = await tx.inventoryItem.findUniqueOrThrow({ where: { id: sourceItem.id } });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: sourceItem.id,
          type: 'TRANSFER',
          quantity: -dto.quantity,
          previousQuantity: sourceItem.onHandQuantity,
          newQuantity: updatedSource.onHandQuantity,
          reason: dto.reason ?? 'Warehouse transfer (out)',
          reference,
          performedById: actor.userId,
        },
      });
      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: destItem.id,
          type: 'TRANSFER',
          quantity: dto.quantity,
          previousQuantity: destPreviousQuantity,
          newQuantity: destItem.onHandQuantity,
          reason: dto.reason ?? 'Warehouse transfer (in)',
          reference,
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryTransferred',
        entityType: 'InventoryItem',
        entityId: sourceItem.id,
        metadata: {
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          productId: dto.productId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          reference,
        },
      });

      return { sourceId: sourceItem.id, destId: destItem.id };
    });

    // Queried only after the transaction above has actually committed - see
    // the identical note in adjust().
    return {
      source: await this.findOne(storeId, sourceId),
      destination: await this.findOne(storeId, destId),
    };
  }

  // ---------------------------------------------------------------------
  // Returns (Phase 10)
  // ---------------------------------------------------------------------

  /**
   * Phase 10 §14/§15/§46 - the ONLY path by which a returned item's physical
   * stock is ever credited back as sellable. Never called directly from a
   * controller (ReturnStatusService is the sole caller, inside its own
   * inspect() transaction) and never called for a DAMAGED/UNSELLABLE
   * disposition - those dispositions never reach here at all, so sellable
   * on-hand quantity can never increase for a damaged item (§46).
   *
   * Idempotent by construction: the caller MUST pass `tx` and must have
   * already atomically claimed the ReturnItem via a conditional
   * `restockedAt: null` update in that SAME transaction before calling this
   * (see ReturnStatusService.inspect()) - exactly the same
   * claim-then-physically-act pattern as OrderStatusService.fulfill()'s own
   * `fulfilledAt: null` guard. A duplicate inspect() submission for an
   * already-restocked item never reaches this method a second time, so
   * on-hand quantity can only ever increase once per ReturnItem (§15).
   *
   * Deliberately does NOT call AuditLogService itself (unlike consume()/
   * release() above, an existing pattern from earlier phases): this was a
   * real defect found during this phase's own concurrency testing -
   * AuditLogService.record() always writes via the OUTER (non-tx) Prisma
   * client, so calling it from inside this method's transaction opened a
   * SECOND connection while the first was still held open. Under 10-way
   * concurrent inspect() calls (§43/§15's own required test) this exhausted
   * the connection pool and produced hard transaction-timeout failures
   * instead of the graceful single-winner/nine-losers outcome the
   * idempotency guard above already guarantees. The caller
   * (ReturnStatusService.inspect()) already records one RETURN_INSPECTED
   * audit entry (including every item's disposition) after its own
   * transaction commits, which fully covers this action - no audit
   * information is lost by removing the second, redundant entry here.
   */
  async restockFromReturn(storeId: string, inventoryItemId: string, quantity: number, reference: string, actor: AuthenticatedUser, tx: Prisma.TransactionClient): Promise<void> {
    const existing = await this.getStoreScopedItemOrThrow(storeId, inventoryItemId, tx);

    const result = await tx.inventoryItem.updateMany({
      where: { id: inventoryItemId, storeId },
      data: { onHandQuantity: { increment: quantity }, availableQuantity: { increment: quantity } },
    });
    if (result.count === 0) {
      throw new NotFoundException('Inventory item not found');
    }
    const updated = await tx.inventoryItem.findUniqueOrThrow({ where: { id: inventoryItemId } });

    await tx.inventoryTransaction.create({
      data: {
        storeId,
        inventoryItemId,
        type: 'RETURN',
        quantity,
        previousQuantity: existing.onHandQuantity,
        newQuantity: updated.onHandQuantity,
        reason: 'Return inspection - RESTOCK disposition',
        reference,
        performedById: actor.userId,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Reservations
  // ---------------------------------------------------------------------

  /**
   * `options.tx` lets a caller that already opened its own transaction (e.g.
   * CheckoutService, which must reserve inventory and create the Order in
   * ONE atomic unit - see the Phase 5 report) run this against that same
   * connection instead of opening a second, independent one. Without this,
   * nesting `this.prisma.$transaction()` inside an outer transaction would
   * silently commit the reservation on its own connection immediately,
   * breaking atomicity with whatever the outer transaction does next.
   * Every existing caller (the admin `/inventory/reservations` route) omits
   * `options` entirely and behaves exactly as before.
   *
   * `options.orderId`/`orderItemId` tag the reservation for checkout's own
   * bookkeeping (release-on-payment-failure, commit-on-payment-success need
   * to find "every reservation for this order") - never client-supplied,
   * only ever passed by CheckoutService itself.
   */
  async reserve(
    storeId: string,
    dto: CreateReservationDto,
    actor: AuthenticatedUser,
    options?: { tx?: Prisma.TransactionClient; orderId?: string; orderItemId?: string },
  ) {
    const client = options?.tx ?? this.prisma;
    const existing = await this.getStoreScopedItemOrThrow(storeId, dto.inventoryItemId, client);
    const expiresAt = new Date(Date.now() + (dto.expiresInMinutes ?? 30) * 60_000);

    const run = async (tx: Prisma.TransactionClient) => {
      const result = await tx.inventoryItem.updateMany({
        where: { id: dto.inventoryItemId, storeId, availableQuantity: { gte: dto.quantity } },
        data: { availableQuantity: { decrement: dto.quantity }, reservedQuantity: { increment: dto.quantity } },
      });
      if (result.count === 0) {
        throw new ConflictException('Insufficient available stock to reserve');
      }

      const reservation = await tx.stockReservation.create({
        data: {
          storeId,
          inventoryItemId: dto.inventoryItemId,
          quantity: dto.quantity,
          status: 'ACTIVE',
          reference: dto.reference,
          expiresAt,
          orderId: options?.orderId,
          orderItemId: options?.orderItemId,
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: existing.id,
          type: 'RESERVATION',
          quantity: dto.quantity,
          previousQuantity: existing.availableQuantity,
          newQuantity: existing.availableQuantity - dto.quantity,
          reason: 'Stock reservation',
          reference: dto.reference,
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryReserved',
        entityType: 'StockReservation',
        entityId: reservation.id,
        metadata: { inventoryItemId: existing.id, quantity: dto.quantity, reference: dto.reference, orderId: options?.orderId },
      });

      return reservation;
    };

    return options?.tx ? run(options.tx) : this.prisma.$transaction(run);
  }

  async release(storeId: string, reservationId: string, actor: AuthenticatedUser, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const reservation = await this.getStoreScopedReservationOrThrow(storeId, reservationId, client);

    // Fast-path rejections that don't need the transaction at all.
    if (reservation.status === 'RELEASED') {
      return reservation; // idempotent no-op - see class-level doc comment.
    }
    if (reservation.status !== 'ACTIVE') {
      throw new ConflictException(`Cannot release a reservation with status ${reservation.status}`);
    }

    const run = async (tx: Prisma.TransactionClient) => {
      // Atomic conditional transition: only flips ACTIVE -> RELEASED if it is
      // STILL ACTIVE at the moment of this write. Without the `status: 'ACTIVE'`
      // guard here, two concurrent release() calls on the same reservation
      // could both pass the pre-check above and then both unconditionally
      // succeed, double-crediting availableQuantity - the exact bug this
      // correction fixes. See the Phase 2F correction report §10.
      const transitioned = await tx.stockReservation.updateMany({
        where: { id: reservationId, storeId, status: 'ACTIVE' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });

      if (transitioned.count === 0) {
        // Lost a race (or the state changed between the pre-check and now) -
        // re-fetch rather than assume, and respond the same way the fast-path
        // above would have.
        const current = await tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
        if (current.status === 'RELEASED') return current;
        throw new ConflictException(`Cannot release a reservation with status ${current.status}`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: reservation.inventoryItemId } });

      await tx.inventoryItem.update({
        where: { id: reservation.inventoryItemId },
        data: { availableQuantity: { increment: reservation.quantity }, reservedQuantity: { decrement: reservation.quantity } },
      });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: reservation.inventoryItemId,
          type: 'RELEASE',
          quantity: reservation.quantity,
          previousQuantity: item.availableQuantity,
          newQuantity: item.availableQuantity + reservation.quantity,
          reason: 'Reservation released',
          reference: reservation.reference,
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryReleased',
        entityType: 'StockReservation',
        entityId: reservationId,
        metadata: { inventoryItemId: reservation.inventoryItemId, quantity: reservation.quantity },
      });

      return tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * ACTIVE -> COMMITTED: converts a temporary hold into a firm allocation
   * (e.g. a paid order). Deliberately idempotent on an already-COMMITTED
   * reservation (returns the existing result rather than erroring) - this
   * mirrors release()'s existing idempotency and is one of the two behaviors
   * this correction explicitly allows (see §9). Consuming a RELEASED
   * reservation remains a genuine invalid transition (409).
   *
   * committedQuantity does NOT move stock: onHand, reservedQuantity and
   * availableQuantity are all untouched by this call. See the class-level
   * doc comment for why - the short version is that under this store's
   * chosen accounting model, reservedQuantity already counts this
   * reservation's quantity as "held" for both ACTIVE and COMMITTED status,
   * so nothing needs to move when the status changes between them.
   */
  async consume(storeId: string, reservationId: string, actor: AuthenticatedUser, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const reservation = await this.getStoreScopedReservationOrThrow(storeId, reservationId, client);

    if (reservation.status === 'RELEASED') {
      throw new ConflictException('Cannot consume a reservation with status RELEASED');
    }

    const run = async (tx: Prisma.TransactionClient) => {
      // Same atomic-conditional-transition pattern as release() above, and for
      // the same reason: without this guard, two concurrent consume() calls on
      // the same reservation could both pass the pre-check and both
      // unconditionally succeed, double-incrementing committedQuantity - the
      // "concurrent commit" bug this correction specifically tests for.
      //
      // Phase 5 correction: the WHERE clause additionally requires the
      // reservation to still be unexpired. A payment confirming after its
      // hold's expiresAt has passed must never silently commit stock that
      // may no longer really be held for it - see §18 of the correction
      // report. This closes the payment-vs-expiry race atomically in the
      // same statement, rather than checking expiresAt separately beforehand
      // (which would leave a TOCTOU gap between the check and the write).
      const transitioned = await tx.stockReservation.updateMany({
        where: { id: reservationId, storeId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
        data: { status: 'COMMITTED' },
      });

      if (transitioned.count === 0) {
        const current = await tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
        if (current.status === 'COMMITTED') return current; // already committed - idempotent, no re-application.
        if (current.status === 'RELEASED') {
          // Final micro-correction: already released by a CONCURRENT
          // consume()/expiry race that got here first (two racing payment
          // confirmations for the same expired reservation, e.g. a client
          // verify call and a webhook redelivery) - or an earlier genuine
          // cancellation. Either way this reservation can no longer back a
          // commit, and the caller (PaymentService) must be able to treat
          // this exactly like "just expired" via the same distinguishable
          // exception, never a raw conflict that would otherwise bubble up
          // as an unhandled error on the losing side of the race.
          throw new ReservationExpiredException(reservationId);
        }
        if (current.status === 'ACTIVE' && current.expiresAt <= new Date()) {
          // Lost the race to its own expiry (or simply arrived too late) -
          // release it for real (crediting stock back atomically, exactly
          // like the background sweep would) rather than leaving it stuck
          // ACTIVE-but-uncommittable, then surface a distinguishable error
          // so the caller never mistakes this for an ordinary conflict.
          await this.release(storeId, reservationId, actor, tx);
          throw new ReservationExpiredException(reservationId);
        }
        throw new ConflictException(`Cannot consume a reservation with status ${current.status}`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: reservation.inventoryItemId } });

      await tx.inventoryItem.update({
        where: { id: reservation.inventoryItemId },
        data: { committedQuantity: { increment: reservation.quantity } },
      });

      // No physical stock moved (onHand/reserved/available are all untouched -
      // see the method doc comment), so the ledger records the movement of
      // the ONE quantity that actually changed: committedQuantity itself.
      // Recording previousQuantity/newQuantity as the reservation's own
      // quantity (as an earlier version of this method did) was misleading -
      // it looked like a stock movement of that size when none occurred.
      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: reservation.inventoryItemId,
          type: 'RESERVATION',
          quantity: reservation.quantity,
          previousQuantity: item.committedQuantity,
          newQuantity: item.committedQuantity + reservation.quantity,
          reason: 'Reservation consumed (committed - no physical stock movement)',
          reference: reservation.reference,
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryConsumed',
        entityType: 'StockReservation',
        entityId: reservationId,
        metadata: { inventoryItemId: reservation.inventoryItemId, quantity: reservation.quantity },
      });

      return tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Phase 6: releases a COMMITTED reservation back to available stock -
   * used ONLY by an explicitly authorized order cancellation (admin or
   * customer, before physical fulfillment has happened - see
   * OrderStatusService), never by expiry or any automatic path. Deliberately
   * a SEPARATE method from release() (which remains ACTIVE-only) so that
   * method's own invariant - a COMMITTED reservation is never released by
   * expiry/failure paths, see the Phase 5 correction report - is never
   * accidentally weakened for ITS callers.
   */
  async releaseCommitted(storeId: string, reservationId: string, actor: AuthenticatedUser, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const reservation = await this.getStoreScopedReservationOrThrow(storeId, reservationId, client);

    if (reservation.status === 'RELEASED') {
      return reservation; // idempotent no-op - same convention as release().
    }
    if (reservation.status !== 'COMMITTED') {
      throw new ConflictException(`Cannot release a reservation with status ${reservation.status} via an order cancellation`);
    }

    const run = async (tx: Prisma.TransactionClient) => {
      // Same atomic-conditional-transition pattern as release()/consume():
      // only flips COMMITTED -> RELEASED if it is STILL COMMITTED at the
      // moment of this write, so two concurrent cancellations (or a
      // cancellation racing a fulfillment) can never double-credit stock.
      const transitioned = await tx.stockReservation.updateMany({
        where: { id: reservationId, storeId, status: 'COMMITTED' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });

      if (transitioned.count === 0) {
        const current = await tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
        if (current.status === 'RELEASED') return current;
        throw new ConflictException(`Cannot release a reservation with status ${current.status} via an order cancellation`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: reservation.inventoryItemId } });

      // Unlike release() (ACTIVE -> RELEASED), a COMMITTED reservation's
      // quantity also counts toward committedQuantity (see the class-level
      // doc comment's accounting model) - both figures are credited back
      // together; onHandQuantity is untouched, since a COMMITTED
      // reservation never physically removed stock (fulfillOrderReservations
      // is the step that does that).
      await tx.inventoryItem.update({
        where: { id: reservation.inventoryItemId },
        data: {
          availableQuantity: { increment: reservation.quantity },
          reservedQuantity: { decrement: reservation.quantity },
          committedQuantity: { decrement: reservation.quantity },
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: reservation.inventoryItemId,
          type: 'RELEASE',
          quantity: reservation.quantity,
          previousQuantity: item.availableQuantity,
          newQuantity: item.availableQuantity + reservation.quantity,
          reason: 'Committed reservation released - order cancelled before fulfillment',
          reference: reservation.reference,
          performedById: actor.userId,
        },
      });

      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'InventoryCommittedReleased',
        entityType: 'StockReservation',
        entityId: reservationId,
        metadata: { inventoryItemId: reservation.inventoryItemId, quantity: reservation.quantity },
      });

      return tx.stockReservation.findUniqueOrThrow({ where: { id: reservationId } });
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * Phase 6 - physical stock consumption at fulfillment. Distinct from
   * consume() (ACTIVE -> COMMITTED, "firm allocation" - moves nothing
   * physical): this is the step where stock actually leaves the warehouse,
   * so onHandQuantity is reduced for real, and the reservation's hold on it
   * (both reservedQuantity and committedQuantity) is released, since the
   * stock is no longer merely "held for later" - it is gone.
   *
   * MUST be called within the SAME transaction as the atomic
   * `fulfilledAt: null` claim on the Order (see OrderStatusService.fulfill) -
   * that claim, not this method itself, is what makes fulfillment
   * idempotent/exactly-once under concurrency (Phase 6 §15). A multi-item
   * order is fulfilled atomically (§16) via a two-phase validate-then-mutate
   * structure: EVERY OrderItem's current reservation is checked to be
   * COMMITTED first, and the whole call throws before touching any
   * inventory at all if even one line is not - a plain
   * `findMany({status:'COMMITTED'})` followed by a loop would instead
   * silently SKIP a line whose reservation was, for whatever reason, not
   * COMMITTED (missing, still ACTIVE, or already RELEASED), leaving that
   * line's stock never physically consumed while the order was still
   * marked fully fulfilled - the micro-correction's forced-rollback test
   * exercises exactly this case. Once validation passes, every line's own
   * atomic conditional update is itself still guarded (defense in depth
   * against a genuinely impossible concurrent mutation between the
   * validation read and this transaction's own write).
   */
  async fulfillOrderReservations(storeId: string, orderId: string, actor: AuthenticatedUser, tx: Prisma.TransactionClient): Promise<void> {
    const orderItems = await tx.orderItem.findMany({ where: { orderId }, select: { id: true } });
    const allReservations = await tx.stockReservation.findMany({ where: { orderId, orderItemId: { not: null } }, orderBy: { createdAt: 'desc' } });

    // Only the MOST RECENT reservation per order line is currently relevant -
    // an earlier, already-superseded row (e.g. from a retry-payment
    // re-reservation) must never be mistaken for this line's real state.
    const latestPerLine = new Map<string, (typeof allReservations)[number]>();
    for (const reservation of allReservations) {
      if (!reservation.orderItemId) continue;
      if (!latestPerLine.has(reservation.orderItemId)) {
        latestPerLine.set(reservation.orderItemId, reservation);
      }
    }

    for (const item of orderItems) {
      const reservation = latestPerLine.get(item.id);
      if (!reservation || reservation.status !== 'COMMITTED') {
        throw new ConflictException(`Order line ${item.id} does not have a COMMITTED reservation - cannot fulfill`);
      }
    }

    const reservations = orderItems.map((item) => latestPerLine.get(item.id)!);

    for (const reservation of reservations) {
      const transitioned = await tx.stockReservation.updateMany({
        where: { id: reservation.id, storeId, status: 'COMMITTED' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      if (transitioned.count === 0) {
        // Validated as COMMITTED just above, in this same transaction - this
        // would mean an impossible concurrent mutation. Fail loudly rather
        // than silently skip a line's physical stock consumption.
        throw new ConflictException(`Reservation ${reservation.id} was not COMMITTED at fulfillment time`);
      }

      const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: reservation.inventoryItemId } });

      await tx.inventoryItem.update({
        where: { id: reservation.inventoryItemId },
        data: {
          onHandQuantity: { decrement: reservation.quantity },
          reservedQuantity: { decrement: reservation.quantity },
          committedQuantity: { decrement: reservation.quantity },
        },
      });

      await tx.inventoryTransaction.create({
        data: {
          storeId,
          inventoryItemId: reservation.inventoryItemId,
          type: 'SALE',
          quantity: -reservation.quantity,
          previousQuantity: item.onHandQuantity,
          newQuantity: item.onHandQuantity - reservation.quantity,
          reason: 'Order fulfilled - stock physically consumed',
          reference: reservation.reference,
          performedById: actor.userId,
        },
      });
    }
  }

  async findReservation(storeId: string, reservationId: string) {
    return this.getStoreScopedReservationOrThrow(storeId, reservationId);
  }

  /** Every non-RELEASED reservation tagged with this order - used by CheckoutService to release/commit them all together. */
  async findReservationsForOrder(storeId: string, orderId: string) {
    return this.prisma.stockReservation.findMany({ where: { storeId, orderId } });
  }

  /**
   * Phase 5 correction: an ACTIVE reservation past its expiresAt must stop
   * reducing availableQuantity, not sit there indefinitely until some
   * unrelated later operation happens to touch it. Scoped to checkout-
   * created reservations only (orderId set) - that's the only case this
   * correction pass covers, and it sidesteps needing a "who created this"
   * actor for a reservation with no owning order to attribute the release
   * to (StockReservation doesn't otherwise track its creator).
   *
   * Reuses release()'s own atomic conditional-transition update for every
   * row it touches, so this is exactly as safe under concurrency as a
   * single manual release() call - see that method's doc comment. Callers
   * needing "expired reservations for a specific product/variant, checked
   * right before an availability decision" (CheckoutService) pass
   * `inventoryItemIds`; a bare background sweep omits it and covers the
   * whole store (or every store, if storeId is also omitted).
   */
  async releaseExpiredReservations(
    storeId: string | undefined,
    options?: { inventoryItemIds?: string[]; orderId?: string; tx?: Prisma.TransactionClient },
  ): Promise<number> {
    const client = options?.tx ?? this.prisma;
    const expired = await client.stockReservation.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
        // Final micro-correction: a caller resolving ONE specific order's
        // finalization (PaymentService) passes `orderId` for an exact
        // match; every existing caller (checkout's per-line sweep, the
        // background sweep) omits it and keeps the original "any
        // order-linked reservation" scope.
        orderId: options?.orderId ?? { not: null },
        ...(storeId ? { storeId } : {}),
        ...(options?.inventoryItemIds ? { inventoryItemId: { in: options.inventoryItemIds } } : {}),
      },
      include: { order: { select: { userId: true } } },
    });

    let releasedCount = 0;
    for (const reservation of expired) {
      if (!reservation.order) continue; // defensive - orderId is set but the order itself is gone somehow.
      // release() is itself the atomic, concurrency-safe conditional
      // transition (see its own doc comment) - calling it per-row here is
      // exactly as safe as a single manual release(), including against a
      // concurrent sweep or a payment racing to consume() the same row.
      const result = await this.release(reservation.storeId, reservation.id, buildSystemActor(reservation.order.userId), options?.tx);
      if (result.status === 'RELEASED') releasedCount += 1;
    }
    return releasedCount;
  }

  /** Named distinctly from CartService.sweepExpiredCarts() - a different concept on a different (~15 min vs 30/90 day) timescale. Entry point for a future background job; safe to call repeatedly. */
  async sweepExpiredReservations(storeId?: string): Promise<number> {
    return this.releaseExpiredReservations(storeId);
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  private async getStoreScopedWarehouseOrThrow(storeId: string, warehouseId: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id: warehouseId, storeId, deletedAt: null } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    return warehouse;
  }

  /** Verifies the product belongs to the store and, if given, the variant belongs to that product. */
  private async validateProductAndVariant(storeId: string, productId: string, variantId?: string): Promise<void> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    if (variantId) {
      const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null } });
      if (!variant) {
        throw new NotFoundException('Variant not found for this product');
      }
    }
  }

  private async getStoreScopedItemOrThrow(storeId: string, id: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const item = await client.inventoryItem.findFirst({ where: { id, storeId } });
    if (!item) {
      throw new NotFoundException('Inventory item not found');
    }
    return item;
  }

  private async getStoreScopedReservationOrThrow(
    storeId: string,
    id: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const reservation = await client.stockReservation.findFirst({ where: { id, storeId } });
    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }
    return reservation;
  }

  private toResponse(
    item: Prisma.InventoryItemGetPayload<{ include: typeof INVENTORY_INCLUDE }>,
  ) {
    return {
      ...item,
      isLowStock: item.availableQuantity <= item.lowStockThreshold,
      isOutOfStock: item.availableQuantity <= 0,
    };
  }
}
