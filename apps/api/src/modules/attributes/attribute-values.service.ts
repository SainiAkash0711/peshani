import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AttributesService } from './attributes.service';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeValueDto } from './dto/update-attribute-value.dto';
import { UpdateAttributeValueStatusDto } from './dto/update-attribute-value-status.dto';
import { ReorderAttributeValuesDto } from './dto/reorder-attribute-values.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@Injectable()
export class AttributeValuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly attributesService: AttributesService,
  ) {}

  async create(storeId: string, attributeId: string, dto: CreateAttributeValueDto, actor: AuthenticatedUser) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);

    const slug = await this.resolveSlug(attributeId, dto.slug, dto.value);

    const attributeValue = await this.prisma.attributeValue.create({
      data: {
        attributeId,
        value: dto.value,
        slug,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeValueCreated',
      entityType: 'AttributeValue',
      entityId: attributeValue.id,
      metadata: { after: attributeValue, attributeId },
    });

    return attributeValue;
  }

  async findAll(storeId: string, attributeId: string, query: PaginationQueryDto) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);

    const where = { attributeId, deletedAt: null };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.attributeValue.findMany({
        where,
        orderBy: { sortOrder: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.attributeValue.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(storeId: string, attributeId: string, valueId: string) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);
    return this.getScopedValueOrThrow(attributeId, valueId);
  }

  async update(
    storeId: string,
    attributeId: string,
    valueId: string,
    dto: UpdateAttributeValueDto,
    actor: AuthenticatedUser,
  ) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);
    const existing = await this.getScopedValueOrThrow(attributeId, valueId);

    let slug = existing.slug;
    if (dto.slug) {
      slug = await this.resolveSlug(attributeId, dto.slug, dto.value ?? existing.value, valueId);
    } else if (dto.value && dto.value !== existing.value) {
      slug = await generateUniqueSlug(dto.value, (candidate) => this.slugExists(attributeId, candidate, valueId));
    }

    const updated = await this.prisma.attributeValue.update({
      where: { id: existing.id },
      data: {
        value: dto.value ?? existing.value,
        slug,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        isActive: dto.isActive ?? existing.isActive,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeValueUpdated',
      entityType: 'AttributeValue',
      entityId: updated.id,
      metadata: { before: existing, after: updated, attributeId },
    });

    return updated;
  }

  async updateStatus(
    storeId: string,
    attributeId: string,
    valueId: string,
    dto: UpdateAttributeValueStatusDto,
    actor: AuthenticatedUser,
  ) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);
    const existing = await this.getScopedValueOrThrow(attributeId, valueId);

    const updated = await this.prisma.attributeValue.update({
      where: { id: existing.id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeValueStatusChanged',
      entityType: 'AttributeValue',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive }, attributeId },
    });

    return updated;
  }

  async reorder(storeId: string, attributeId: string, dto: ReorderAttributeValuesDto, actor: AuthenticatedUser) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);

    const ids = dto.items.map((item) => item.id);
    const owned = await this.prisma.attributeValue.findMany({
      where: { id: { in: ids }, attributeId, deletedAt: null },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more attribute values were not found under this attribute');
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.attributeValue.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    );

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeValueReordered',
      entityType: 'AttributeValue',
      metadata: { items: dto.items, attributeId },
    });

    return { updated: dto.items.length };
  }

  async remove(storeId: string, attributeId: string, valueId: string, actor: AuthenticatedUser) {
    await this.attributesService.getStoreScopedAttributeOrThrow(storeId, attributeId);
    const existing = await this.getScopedValueOrThrow(attributeId, valueId);

    const variantUsage = await this.prisma.productVariantAttributeValue.count({
      where: { attributeValueId: valueId },
    });
    if (variantUsage > 0) {
      throw new ConflictException(
        `Cannot delete value "${existing.value}": ${variantUsage} variant(s) use it. Deactivate it instead.`,
      );
    }

    const deleted = await this.prisma.attributeValue.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeValueDeleted',
      entityType: 'AttributeValue',
      entityId: deleted.id,
      metadata: { before: existing, attributeId },
    });

    return { id: deleted.id };
  }

  private async getScopedValueOrThrow(attributeId: string, valueId: string) {
    const value = await this.prisma.attributeValue.findFirst({
      where: { id: valueId, attributeId, deletedAt: null },
    });
    if (!value) {
      throw new NotFoundException('Attribute value not found');
    }
    return value;
  }

  private async slugExists(attributeId: string, slug: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.attributeValue.findFirst({
      where: { attributeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private async resolveSlug(
    attributeId: string,
    providedSlug: string | undefined,
    value: string,
    excludeId?: string,
  ): Promise<string> {
    if (providedSlug) {
      if (await this.slugExists(attributeId, providedSlug, excludeId)) {
        throw new ConflictException(`Slug "${providedSlug}" is already in use for this attribute`);
      }
      return providedSlug;
    }
    return generateUniqueSlug(value, (candidate) => this.slugExists(attributeId, candidate, excludeId));
  }
}
