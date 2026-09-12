import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { QueryAttributeDto } from './dto/query-attribute.dto';
import { UpdateAttributeStatusDto } from './dto/update-attribute-status.dto';

@Injectable()
export class AttributesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateAttributeDto, actor: AuthenticatedUser) {
    const slug = await this.resolveSlug(storeId, dto.slug, dto.name);

    const attribute = await this.prisma.attribute.create({
      data: {
        storeId,
        name: dto.name,
        slug,
        type: dto.type,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeCreated',
      entityType: 'Attribute',
      entityId: attribute.id,
      metadata: { after: attribute },
    });

    return attribute;
  }

  async findAll(storeId: string, query: QueryAttributeDto) {
    const where: Prisma.AttributeWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.attribute.findMany({
        where,
        orderBy: { [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.attribute.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    return this.getStoreScopedAttributeOrThrow(storeId, id);
  }

  async update(storeId: string, id: string, dto: UpdateAttributeDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedAttributeOrThrow(storeId, id);

    let slug = existing.slug;
    if (dto.slug) {
      slug = await this.resolveSlug(storeId, dto.slug, dto.name ?? existing.name, id);
    } else if (dto.name && dto.name !== existing.name) {
      slug = await generateUniqueSlug(dto.name, (candidate) => this.slugExists(storeId, candidate, id));
    }

    const updated = await this.prisma.attribute.update({
      where: { id: existing.id },
      data: {
        name: dto.name ?? existing.name,
        slug,
        type: dto.type ?? existing.type,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        isActive: dto.isActive ?? existing.isActive,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeUpdated',
      entityType: 'Attribute',
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return updated;
  }

  async updateStatus(storeId: string, id: string, dto: UpdateAttributeStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedAttributeOrThrow(storeId, id);

    const updated = await this.prisma.attribute.update({
      where: { id: existing.id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeStatusChanged',
      entityType: 'Attribute',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return updated;
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedAttributeOrThrow(storeId, id);

    const [productUsage, variantUsage] = await Promise.all([
      this.prisma.productAttribute.count({ where: { attributeId: id } }),
      this.prisma.productVariantAttributeValue.count({ where: { attributeValue: { attributeId: id } } }),
    ]);

    if (productUsage > 0) {
      throw new ConflictException(
        `Cannot delete attribute "${existing.name}": ${productUsage} product(s) use it. Remove it from those products first.`,
      );
    }
    if (variantUsage > 0) {
      throw new ConflictException(
        `Cannot delete attribute "${existing.name}": ${variantUsage} variant(s) use one of its values. Deactivate it instead.`,
      );
    }

    const deleted = await this.prisma.attribute.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'AttributeDeleted',
      entityType: 'Attribute',
      entityId: deleted.id,
      metadata: { before: existing },
    });

    return { id: deleted.id };
  }

  async getStoreScopedAttributeOrThrow(storeId: string, id: string) {
    const attribute = await this.prisma.attribute.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!attribute) {
      throw new NotFoundException('Attribute not found');
    }
    return attribute;
  }

  // See CategoriesService.slugExists for why soft-deleted rows are NOT excluded
  // here: the @@unique([storeId, slug]) DB constraint covers them too.
  private async slugExists(storeId: string, slug: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.attribute.findFirst({
      where: { storeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  private async resolveSlug(
    storeId: string,
    providedSlug: string | undefined,
    name: string,
    excludeId?: string,
  ): Promise<string> {
    if (providedSlug) {
      if (await this.slugExists(storeId, providedSlug, excludeId)) {
        throw new ConflictException(`Slug "${providedSlug}" is already in use in this store`);
      }
      return providedSlug;
    }
    return generateUniqueSlug(name, (candidate) => this.slugExists(storeId, candidate, excludeId));
  }
}
