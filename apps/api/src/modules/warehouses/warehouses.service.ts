import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { UpdateWarehouseStatusDto } from './dto/update-warehouse-status.dto';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateWarehouseDto, actor: AuthenticatedUser) {
    if (await this.codeExists(storeId, dto.code)) {
      throw new ConflictException(`Warehouse code "${dto.code}" is already in use in this store`);
    }

    const warehouse = await this.prisma.warehouse.create({
      data: {
        storeId,
        name: dto.name,
        code: dto.code,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        state: dto.state,
        country: dto.country,
        postalCode: dto.postalCode,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'WarehouseCreated',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      metadata: { after: warehouse },
    });

    return warehouse;
  }

  async findAll(storeId: string, query: QueryWarehouseDto) {
    const where: Prisma.WarehouseWhereInput = {
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
      this.prisma.warehouse.findMany({
        where,
        orderBy: { [query.sortBy ?? 'name']: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.warehouse.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    return this.getStoreScopedWarehouseOrThrow(storeId, id);
  }

  async update(storeId: string, id: string, dto: UpdateWarehouseDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedWarehouseOrThrow(storeId, id);

    if (dto.code && dto.code !== existing.code && (await this.codeExists(storeId, dto.code, id))) {
      throw new ConflictException(`Warehouse code "${dto.code}" is already in use in this store`);
    }

    const updated = await this.prisma.warehouse.update({
      where: { id: existing.id },
      data: {
        name: dto.name ?? existing.name,
        code: dto.code ?? existing.code,
        addressLine1: dto.addressLine1 !== undefined ? dto.addressLine1 : existing.addressLine1,
        addressLine2: dto.addressLine2 !== undefined ? dto.addressLine2 : existing.addressLine2,
        city: dto.city !== undefined ? dto.city : existing.city,
        state: dto.state !== undefined ? dto.state : existing.state,
        country: dto.country !== undefined ? dto.country : existing.country,
        postalCode: dto.postalCode !== undefined ? dto.postalCode : existing.postalCode,
        isDefault: dto.isDefault ?? existing.isDefault,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'WarehouseUpdated',
      entityType: 'Warehouse',
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return updated;
  }

  async updateStatus(storeId: string, id: string, dto: UpdateWarehouseStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedWarehouseOrThrow(storeId, id);

    const updated = await this.prisma.warehouse.update({
      where: { id: existing.id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'WarehouseStatusChanged',
      entityType: 'Warehouse',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return updated;
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedWarehouseOrThrow(storeId, id);

    const stockedItems = await this.prisma.inventoryItem.count({
      where: { warehouseId: id, OR: [{ onHandQuantity: { gt: 0 } }, { reservedQuantity: { gt: 0 } }] },
    });
    if (stockedItems > 0) {
      throw new ConflictException(
        `Cannot delete warehouse "${existing.name}": it holds stock or active reservations for ${stockedItems} item(s). Deactivate it instead.`,
      );
    }

    const deleted = await this.prisma.warehouse.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'WarehouseDeleted',
      entityType: 'Warehouse',
      entityId: deleted.id,
      metadata: { before: existing },
    });

    return { id: deleted.id };
  }

  async getStoreScopedWarehouseOrThrow(storeId: string, id: string) {
    const warehouse = await this.prisma.warehouse.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!warehouse) {
      throw new NotFoundException('Warehouse not found');
    }
    return warehouse;
  }

  private async codeExists(storeId: string, code: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.warehouse.findFirst({
      where: { storeId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }
}
