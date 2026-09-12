import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateShippingMethodDto } from './dto/create-shipping-method.dto';
import { UpdateShippingMethodDto } from './dto/update-shipping-method.dto';
import { QueryShippingMethodDto } from './dto/query-shipping-method.dto';
import { UpdateShippingMethodStatusDto } from './dto/update-shipping-method-status.dto';

/**
 * Phase 6 - admin CRUD for merchant-configured shipping methods. No external
 * courier integration (see Phase 6 scope boundary) - this is purely a
 * name/price/estimated-days row, looked up server-side by CheckoutService so
 * the client can never dictate its own shipping price (§6/§7 of the Phase 6
 * prompt). Mirrors WarehousesService's CRUD/status/soft-delete shape exactly.
 */
@Injectable()
export class ShippingMethodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateShippingMethodDto, actor: AuthenticatedUser) {
    if (await this.codeExists(storeId, dto.code)) {
      throw new ConflictException(`Shipping method code "${dto.code}" is already in use in this store`);
    }

    const method = await this.prisma.shippingMethod.create({
      data: {
        storeId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        price: dto.price,
        estimatedDeliveryDays: dto.estimatedDeliveryDays,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ShippingMethodCreated',
      entityType: 'ShippingMethod',
      entityId: method.id,
      metadata: { after: this.toSafe(method) },
    });

    return this.toSafe(method);
  }

  async findAll(storeId: string, query: QueryShippingMethodDto) {
    const where: Prisma.ShippingMethodWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.shippingMethod.findMany({
        where,
        orderBy: { [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.shippingMethod.count({ where }),
    ]);

    return paginate(items.map((item) => this.toSafe(item)), total, query.page, query.pageSize);
  }

  /** Public, unauthenticated listing for the customer-facing checkout flow - active methods only, no pagination (a store has few shipping methods). */
  async findActiveForStorefront(storeId: string) {
    const items = await this.prisma.shippingMethod.findMany({
      where: { storeId, isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
    return items.map((item) => this.toSafe(item));
  }

  async findOne(storeId: string, id: string) {
    return this.toSafe(await this.getStoreScopedOrThrow(storeId, id));
  }

  async update(storeId: string, id: string, dto: UpdateShippingMethodDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    if (dto.code && dto.code !== existing.code && (await this.codeExists(storeId, dto.code, id))) {
      throw new ConflictException(`Shipping method code "${dto.code}" is already in use in this store`);
    }

    const updated = await this.prisma.shippingMethod.update({
      where: { id: existing.id },
      data: {
        name: dto.name ?? existing.name,
        code: dto.code ?? existing.code,
        description: dto.description !== undefined ? dto.description : existing.description,
        price: dto.price ?? existing.price,
        estimatedDeliveryDays: dto.estimatedDeliveryDays !== undefined ? dto.estimatedDeliveryDays : existing.estimatedDeliveryDays,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ShippingMethodUpdated',
      entityType: 'ShippingMethod',
      entityId: updated.id,
      metadata: { before: this.toSafe(existing), after: this.toSafe(updated) },
    });

    return this.toSafe(updated);
  }

  async updateStatus(storeId: string, id: string, dto: UpdateShippingMethodStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const updated = await this.prisma.shippingMethod.update({
      where: { id: existing.id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: dto.isActive ? 'ShippingMethodActivated' : 'ShippingMethodDeactivated',
      entityType: 'ShippingMethod',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return this.toSafe(updated);
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedOrThrow(storeId, id);

    const ordersUsingIt = await this.prisma.order.count({ where: { shippingMethodId: id } });
    if (ordersUsingIt > 0) {
      throw new ConflictException(
        `Cannot delete shipping method "${existing.name}": it is referenced by ${ordersUsingIt} existing order(s). Deactivate it instead.`,
      );
    }

    const deleted = await this.prisma.shippingMethod.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ShippingMethodDeleted',
      entityType: 'ShippingMethod',
      entityId: deleted.id,
      metadata: { before: this.toSafe(existing) },
    });

    return { id: deleted.id };
  }

  /**
   * Server-authoritative price lookup for checkout (§6/§7 of the Phase 6
   * prompt) - the client supplies only an id; everything else (price,
   * eligibility) is derived here, never trusted from the request body.
   * Throws if the method doesn't exist, belongs to another store, is
   * inactive, or was soft-deleted - all indistinguishable "unavailable"
   * cases from the customer's point of view (Race 5).
   */
  async getActiveOrThrow(storeId: string, id: string) {
    const method = await this.prisma.shippingMethod.findFirst({ where: { id, storeId, isActive: true, deletedAt: null } });
    if (!method) {
      throw new NotFoundException('Selected shipping method is not available');
    }
    return method;
  }

  private async getStoreScopedOrThrow(storeId: string, id: string) {
    const method = await this.prisma.shippingMethod.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!method) {
      throw new NotFoundException('Shipping method not found');
    }
    return method;
  }

  private async codeExists(storeId: string, code: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.shippingMethod.findFirst({
      where: { storeId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private toSafe(method: { price: Prisma.Decimal } & Record<string, unknown>) {
    return { ...method, price: method.price.toFixed(2) };
  }
}
