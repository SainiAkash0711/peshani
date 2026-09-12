import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface PublicCategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image: string | null;
  isFeatured: boolean;
}

export interface PublicCategoryTreeNode extends PublicCategorySummary {
  children: PublicCategoryTreeNode[];
}

const SUMMARY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  image: true,
  isFeatured: true,
} satisfies Prisma.CategorySelect;

const BREADCRUMB_SELECT = { ...SUMMARY_SELECT, parentId: true } satisfies Prisma.CategorySelect;
type BreadcrumbRow = Prisma.CategoryGetPayload<{ select: typeof BREADCRUMB_SELECT }>;

@Injectable()
export class StorefrontCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full active category tree, for site navigation and the categories landing page. */
  async getTree(storeId: string): Promise<PublicCategoryTreeNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { storeId, deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { ...SUMMARY_SELECT, parentId: true },
    });

    const nodesById = new Map<string, PublicCategoryTreeNode>(
      categories.map((c) => {
        const { parentId: _parentId, ...summary } = c;
        return [c.id, { ...summary, children: [] }];
      }),
    );
    const roots: PublicCategoryTreeNode[] = [];

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

  async getFeatured(storeId: string, limit: number): Promise<PublicCategorySummary[]> {
    return this.prisma.category.findMany({
      where: { storeId, deletedAt: null, isActive: true, isFeatured: true },
      orderBy: { sortOrder: 'asc' },
      take: limit,
      select: SUMMARY_SELECT,
    });
  }

  async getBySlugOrThrow(storeId: string, slug: string) {
    const category = await this.prisma.category.findFirst({
      where: { storeId, slug, deletedAt: null, isActive: true },
      select: {
        ...SUMMARY_SELECT,
        parentId: true,
        bannerImage: true,
        seoTitle: true,
        seoDescription: true,
      },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  /** Root-to-self chain of {id,name,slug}, for breadcrumb rendering. Excludes any inactive ancestor. */
  async getBreadcrumbs(storeId: string, categoryId: string): Promise<PublicCategorySummary[]> {
    const chain: PublicCategorySummary[] = [];
    let currentId: string | null = categoryId;
    const maxDepth = 50;

    for (let depth = 0; depth < maxDepth && currentId; depth += 1) {
      const current: BreadcrumbRow | null = await this.prisma.category.findFirst({
        where: { id: currentId, storeId, deletedAt: null, isActive: true },
        select: BREADCRUMB_SELECT,
      });
      if (!current) break;
      chain.unshift({
        id: current.id,
        name: current.name,
        slug: current.slug,
        description: current.description,
        image: current.image,
        isFeatured: current.isFeatured,
      });
      currentId = current.parentId;
    }

    return chain;
  }

  async getChildren(storeId: string, parentId: string): Promise<PublicCategorySummary[]> {
    return this.prisma.category.findMany({
      where: { storeId, parentId, deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: SUMMARY_SELECT,
    });
  }

  /**
   * `categoryId` plus every active descendant beneath it, so filtering
   * products "by category" is hierarchy-aware (e.g. picking "Electronics"
   * also returns products filed only under its "Phones" child).
   */
  async getSelfAndDescendantIds(storeId: string, categoryId: string): Promise<string[]> {
    const all = await this.prisma.category.findMany({
      where: { storeId, deletedAt: null, isActive: true },
      select: { id: true, parentId: true },
    });

    const childrenByParent = new Map<string, string[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c.id);
      childrenByParent.set(c.parentId, list);
    }

    const result: string[] = [];
    const queue = [categoryId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      result.push(id);
      queue.push(...(childrenByParent.get(id) ?? []));
    }
    return result;
  }
}
