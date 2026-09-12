import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryAdminReturnsDto } from './dto/query-admin-returns.dto';

const ADMIN_RETURN_INCLUDE = {
  items: { include: { orderItem: { select: { id: true, productNameSnapshot: true, variantNameSnapshot: true, skuSnapshot: true, unitPrice: true, quantity: true } } } },
  evidence: true,
  refunds: { orderBy: { createdAt: 'desc' as const } },
  order: { select: { id: true, orderNumber: true, placedAt: true, status: true, currency: true } },
  user: { select: { id: true, email: true, firstName: true, lastName: true } },
} satisfies Prisma.ReturnRequestInclude;

/** §30/§31/§32 - admin visibility, always scoped to the admin's OWN storeId (§41) - never a cross-tenant leak. */
@Injectable()
export class AdminReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(storeId: string, query: QueryAdminReturnsDto) {
    const where: Prisma.ReturnRequestWhereInput = { storeId };
    if (query.status) where.status = query.status;
    if (query.reason) where.reason = query.reason;
    if (query.userId) where.userId = query.userId;
    if (query.orderNumber) where.order = { orderNumber: { contains: query.orderNumber, mode: 'insensitive' } };
    if (query.fromDate || query.toDate) {
      where.requestedAt = {
        ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
        ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.returnRequest.findMany({
        where,
        include: ADMIN_RETURN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.returnRequest.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async findOne(storeId: string, id: string) {
    const returnRequest = await this.prisma.returnRequest.findFirst({ where: { id, storeId }, include: ADMIN_RETURN_INCLUDE });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }
    return returnRequest;
  }
}
