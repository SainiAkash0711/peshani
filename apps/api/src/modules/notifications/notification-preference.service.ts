import { Injectable } from '@nestjs/common';
import { NotificationPreferenceKey } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

export const ALL_PREFERENCE_KEYS: NotificationPreferenceKey[] = [
  'EMAIL_ORDER_UPDATES',
  'EMAIL_PAYMENT_UPDATES',
  'EMAIL_SHIPPING_UPDATES',
  'EMAIL_REVIEW_UPDATES',
  'EMAIL_PROMOTION_UPDATES',
  'IN_APP_ORDER_UPDATES',
  'IN_APP_PAYMENT_UPDATES',
  'IN_APP_SHIPPING_UPDATES',
  'IN_APP_REVIEW_UPDATES',
  'IN_APP_PROMOTION_UPDATES',
];

/**
 * §6 - a missing row for a key means "enabled" (the sensible default for a
 * transactional store - a customer only ever gets a row once they've
 * explicitly changed something away from that default). Only the
 * authenticated customer themselves may read or change their own rows -
 * storeId/userId always come from the JWT (see the two customer
 * controllers), never accepted from the request body.
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(storeId: string, userId: string): Promise<Record<NotificationPreferenceKey, boolean>> {
    const rows = await this.prisma.notificationPreference.findMany({ where: { storeId, userId } });
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    const result = {} as Record<NotificationPreferenceKey, boolean>;
    for (const key of ALL_PREFERENCE_KEYS) {
      result[key] = byKey.get(key) ?? true;
    }
    return result;
  }

  async updateForUser(storeId: string, userId: string, dto: UpdateNotificationPreferencesDto): Promise<Record<NotificationPreferenceKey, boolean>> {
    const entries = Object.entries(dto).filter(([key]) => (ALL_PREFERENCE_KEYS as string[]).includes(key)) as [NotificationPreferenceKey, boolean | undefined][];
    for (const [key, enabled] of entries) {
      if (enabled === undefined) continue;
      await this.prisma.notificationPreference.upsert({
        where: { storeId_userId_key: { storeId, userId, key } },
        update: { enabled },
        create: { storeId, userId, key, enabled },
      });
    }
    return this.getForUser(storeId, userId);
  }

  /** True (the safe default) if the customer has no row for this key at all. */
  async isEnabled(storeId: string, userId: string, key: NotificationPreferenceKey): Promise<boolean> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { storeId_userId_key: { storeId, userId, key } } });
    return row?.enabled ?? true;
  }
}
