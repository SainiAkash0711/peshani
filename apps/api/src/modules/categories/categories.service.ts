import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { generateUniqueSlug } from '../../common/utils/slug.util';
import { paginate } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoryDto } from './dto/query-category.dto';
import { UpdateCategoryStatusDto } from './dto/update-category-status.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';

export interface CategoryTreeNode {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  sortOrder: number;
  children: CategoryTreeNode[];
}

const MAX_ANCESTOR_DEPTH = 200;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(storeId: string, dto: CreateCategoryDto, actor: AuthenticatedUser) {
    if (dto.parentId) {
      await this.getStoreScopedCategoryOrThrow(storeId, dto.parentId);
    }

    const slug = await this.resolveSlug(storeId, dto.slug, dto.name);

    const category = await this.prisma.category.create({
      data: {
        storeId,
        name: dto.name,
        slug,
        description: dto.description,
        parentId: dto.parentId,
        image: dto.image,
        bannerImage: dto.bannerImage,
        seoTitle: dto.seoTitle,
        seoDescription: dto.seoDescription,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        isFeatured: dto.isFeatured ?? false,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CategoryCreated',
      entityType: 'Category',
      entityId: category.id,
      metadata: { after: category },
    });

    return category;
  }

  async findAll(storeId: string, query: QueryCategoryDto) {
    const where: Prisma.CategoryWhereInput = {
      storeId,
      deletedAt: null,
      ...(query.status ? { isActive: query.status === 'active' } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.rootOnly ? { parentId: null } : {}),
      ...(query.subcategoriesOnly ? { parentId: { not: null } } : {}),
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
      this.prisma.category.findMany({
        where,
        orderBy: { [query.sortBy ?? 'sortOrder']: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.category.count({ where }),
    ]);

    const subcategoryCounts = await this.prisma.category.groupBy({
      by: ['parentId'],
      where: { storeId, deletedAt: null, parentId: { in: items.map((item) => item.id) } },
      _count: { _all: true },
    });
    const countByParentId = new Map(subcategoryCounts.map((c) => [c.parentId as string, c._count._all]));
    const itemsWithCount = items.map((item) => ({
      ...item,
      subcategoryCount: countByParentId.get(item.id) ?? 0,
    }));

    return paginate(itemsWithCount, total, query.page, query.pageSize);
  }

  async findTree(storeId: string): Promise<CategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { storeId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, parentId: true, name: true, slug: true, isActive: true, sortOrder: true },
    });

    const nodesById = new Map<string, CategoryTreeNode>(
      categories.map((c) => [c.id, { ...c, children: [] }]),
    );
    const roots: CategoryTreeNode[] = [];

    for (const category of categories) {
      const node = nodesById.get(category.id)!;
      const parent = category.parentId ? nodesById.get(category.parentId) : undefined;
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async findOne(storeId: string, id: string) {
    return this.getStoreScopedCategoryOrThrow(storeId, id);
  }

  async update(storeId: string, id: string, dto: UpdateCategoryDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedCategoryOrThrow(storeId, id);

    if (dto.parentId !== undefined && dto.parentId !== existing.parentId) {
      if (dto.parentId !== null) {
        await this.getStoreScopedCategoryOrThrow(storeId, dto.parentId);
        await this.assertNoCycle(storeId, id, dto.parentId);
      }
    }

    let slug = existing.slug;
    if (dto.slug) {
      slug = await this.resolveSlug(storeId, dto.slug, dto.name ?? existing.name, id);
    } else if (dto.name && dto.name !== existing.name) {
      slug = await generateUniqueSlug(dto.name, (candidate) => this.slugExists(storeId, candidate, id));
    }

    const updated = await this.prisma.category.update({
      where: { id: existing.id },
      data: {
        name: dto.name ?? existing.name,
        slug,
        description: dto.description !== undefined ? dto.description : existing.description,
        parentId: dto.parentId !== undefined ? dto.parentId : existing.parentId,
        image: dto.image !== undefined ? dto.image : existing.image,
        bannerImage: dto.bannerImage !== undefined ? dto.bannerImage : existing.bannerImage,
        seoTitle: dto.seoTitle !== undefined ? dto.seoTitle : existing.seoTitle,
        seoDescription: dto.seoDescription !== undefined ? dto.seoDescription : existing.seoDescription,
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        isActive: dto.isActive ?? existing.isActive,
        isFeatured: dto.isFeatured ?? existing.isFeatured,
      },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: dto.parentId !== undefined && dto.parentId !== existing.parentId ? 'CategoryParentChanged' : 'CategoryUpdated',
      entityType: 'Category',
      entityId: updated.id,
      metadata: { before: existing, after: updated },
    });

    return updated;
  }

  async updateStatus(storeId: string, id: string, dto: UpdateCategoryStatusDto, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedCategoryOrThrow(storeId, id);

    const updated = await this.prisma.category.update({
      where: { id: existing.id },
      data: { isActive: dto.isActive },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CategoryStatusChanged',
      entityType: 'Category',
      entityId: updated.id,
      metadata: { before: { isActive: existing.isActive }, after: { isActive: updated.isActive } },
    });

    return updated;
  }

  async reorder(storeId: string, dto: ReorderCategoriesDto, actor: AuthenticatedUser) {
    const ids = dto.items.map((item) => item.id);
    const owned = await this.prisma.category.findMany({
      where: { id: { in: ids }, storeId, deletedAt: null },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      throw new NotFoundException('One or more categories were not found in this store');
    }

    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.category.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder } }),
      ),
    );

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CategoryReordered',
      entityType: 'Category',
      metadata: { items: dto.items },
    });

    return { updated: dto.items.length };
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getStoreScopedCategoryOrThrow(storeId, id);

    const [childCount, productCount] = await Promise.all([
      this.prisma.category.count({ where: { parentId: id, deletedAt: null } }),
      this.prisma.productCategory.count({ where: { categoryId: id } }),
    ]);

    if (childCount > 0) {
      throw new ConflictException(
        `Cannot delete category "${existing.name}": it has ${childCount} child categor${childCount === 1 ? 'y' : 'ies'}. Move or delete them first.`,
      );
    }
    if (productCount > 0) {
      throw new ConflictException(
        `Cannot delete category "${existing.name}": ${productCount} product(s) are assigned to it. Reassign them first.`,
      );
    }

    const deleted = await this.prisma.category.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'CategoryDeleted',
      entityType: 'Category',
      entityId: deleted.id,
      metadata: { before: existing },
    });

    return { id: deleted.id };
  }

  private async getStoreScopedCategoryOrThrow(storeId: string, id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /**
   * An explicit slug the admin typed is validated, not silently mutated: a
   * collision is rejected with a clear conflict rather than becoming
   * "mens-clothing-2" behind their back. A slug derived from the name is
   * expected to auto-suffix on collision instead (see `generateUniqueSlug`).
   */
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

  // Deliberately does NOT exclude soft-deleted rows: the @@unique([storeId, slug])
  // DB constraint covers them too (Postgres has no concept of "soft delete"), so a
  // deleted category's slug stays reserved forever. This keeps app-level and DB-level
  // uniqueness in agreement - if it only checked active rows, a slug freed up by a
  // soft-delete could pass this check and then crash on the raw DB constraint.
  private async slugExists(storeId: string, slug: string, excludeId?: string): Promise<boolean> {
    const match = await this.prisma.category.findFirst({
      where: { storeId, slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return !!match;
  }

  /** Walks up from `newParentId` toward the root; rejects if `categoryId` appears in that chain. */
  private async assertNoCycle(storeId: string, categoryId: string, newParentId: string): Promise<void> {
    if (newParentId === categoryId) {
      throw new BadRequestException('A category cannot be its own parent');
    }

    let currentId: string | null = newParentId;
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && currentId; depth += 1) {
      const current: { id: string; parentId: string | null } | null = await this.prisma.category.findFirst({
        where: { id: currentId, storeId },
        select: { id: true, parentId: true },
      });
      if (!current) {
        throw new NotFoundException('Category not found');
      }
      if (current.id === categoryId) {
        throw new ConflictException('Cannot move a category under its own descendant');
      }
      currentId = current.parentId;
    }
  }
}
