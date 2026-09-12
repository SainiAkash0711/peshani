import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const DEFAULT_STORE_SLUG = 'peshani';

@Injectable()
export class StoreSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Phase 1 ships a single store. Every caller resolves "the current store"
   * through this method so multi-store routing (by domain/header) can be
   * introduced later without touching call sites.
   */
  async getDefaultStore() {
    const store = await this.prisma.store.findUnique({ where: { slug: DEFAULT_STORE_SLUG } });
    if (!store) {
      throw new NotFoundException('Store is not configured. Run the database seed first.');
    }
    return store;
  }

  async getAllSettings(storeId: string): Promise<Record<string, string>> {
    const settings = await this.prisma.storeSetting.findMany({ where: { storeId } });
    return Object.fromEntries(settings.map((s) => [s.key, s.value]));
  }

  async upsertSetting(storeId: string, key: string, value: string) {
    return this.prisma.storeSetting.upsert({
      where: { storeId_key: { storeId, key } },
      update: { value },
      create: { storeId, key, value },
    });
  }
}
