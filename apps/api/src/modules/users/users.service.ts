import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  type: true,
  isActive: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listByStore(storeId: string, page = 1, pageSize = 20) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { storeId },
        select: SAFE_USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where: { storeId } }),
    ]);
    return { items, total, page, pageSize };
  }

  async findById(storeId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, storeId },
      select: SAFE_USER_SELECT,
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
}
