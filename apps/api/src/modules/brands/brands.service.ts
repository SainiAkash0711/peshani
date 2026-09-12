import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { QueryBrandDto } from './dto/query-brand.dto';
import { UpdateBrandStatusDto } from './dto/update-brand-status.dto';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateBrandDto, actor: AuthenticatedUser) {
    const slug = await this.resolveSlug(storeId, dto.slug, dto.name);

    const brand = await this.prisma.brand.create({
      data: {
        storeId,
        name: dto.name,
        slug,
        description: dto.description,
        logo: dto.logo,
        website: dto.website,
        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BrandCreated',
      entityType: 'Brand',
      entityId: brand.id,
      metadata: { after: brand },
    });

    return brand;
  }

  async findAll(storeId: string, query: QueryBrandDto) {
    const where: Prisma.BrandWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
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
      this.prisma.brand.findMany({
        where,
        orderBy: { [query.sortBy ?? 'name']: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    return this.getStoreScopedBrandOrThrow(storeId, id);
  }

  async update(storeId: string, id: string, dto: UpdateBrandDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedBrandOrThrow(storeId, id);

    let slug = existing.slug;
    if (dto.slug) {
      slug = await this.resolveSlug(storeId, dto.slug, dto.name ?? existing.name, id);
    } else if (dto.name && dto.name !== existing.name) {
      slug = await generateUniqueSlug(dto.name, (candidate) => this.slugExists(storeId, candidate, id));
    }

    const updated = await this.prisma.brand.update({
      where: { id: existing.id },
      data: {
        name: dto.name ?? existing.name,
        slug,
        description: dto.description !== undefined ? dto.description : existing.description,
        logo: dto.logo !== undefined ? dto.logo : existing.logo,
        website: dto.website !== undefined ? dto.website : existing.website,
        seoTitle: dto.seoTitle !== undefined ? dto.seoTitle : existing.seoTitle,
        seoDescription: dto.seoDescription !== undefined ? dto.seoDescription : existing.seoDescription,
        isActive: dto.isActive ?? existing.isActive,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BrandUpdated',
      entityType: 'Brand',
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return updated;
  }

  async updateStatus(storeId: string, id: string, dto: UpdateBrandStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedBrandOrThrow(storeId, id);

    const updated = await this.prisma.brand.update({
      where: { id: existing.id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BrandStatusChanged',
      entityType: 'Brand',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return updated;
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedBrandOrThrow(storeId, id);

    const productCount = await this.prisma.product.count({ where: { brandId: id } });
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete brand "${existing.name}": ${productCount} product(s) are assigned to it. Reassign them first.`,
      );
    }

    const deleted = await this.prisma.brand.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'BrandDeleted',
      entityType: 'Brand',
      entityId: deleted.id,
      metadata: { before: existing },
    });

    return { id: deleted.id };
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

  private async getStoreScopedBrandOrThrow(storeId: string, id: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return brand;
  }

  // Deliberately does NOT exclude soft-deleted rows - see the matching note in
  // CategoriesService.slugExists: the DB's @@unique([storeId, slug]) constraint
  // covers deleted rows too, so this check has to agree with it.
  private async slugExists(storeId: string, slug: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.brand.findFirst({
      where: { storeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }
}
