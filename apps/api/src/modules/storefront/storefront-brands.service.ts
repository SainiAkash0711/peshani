import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export interface PublicBrandSummary {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
}

const SUMMARY_SELECT = { id: true, name: true, slug: true, logo: true } as const;

@Injectable()
export class StorefrontBrandsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(storeId: string, query: PaginationQueryDto) {
    const where = {
      storeId,
      deletedAt: null,
      isActive: true,
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.brand.findMany({
        where,
        orderBy: { name: query.sortOrder ?? 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: SUMMARY_SELECT,
      }),
      this.prisma.brand.count({ where }),
    ]);

    return paginate(items, total, query.page, query.pageSize);
  }

  async getBySlugOrThrow(storeId: string, slug: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { storeId, slug, deletedAt: null, isActive: true },
      select: { ...SUMMARY_SELECT, description: true, website: true, seoTitle: true, seoDescription: true },
    });
    if (!brand) {
      throw new NotFoundException('Brand not found');
    }
    return brand;
  }
}
