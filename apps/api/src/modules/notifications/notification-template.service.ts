import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { DEFAULT_TEMPLATES, DefaultTemplateContent } from './template-defaults';
import { CreateNotificationTemplateDto } from './dto/create-notification-template.dto';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

/**
 * Tenant-aware (§5) reusable template content, with a built-in fallback
 * (template-defaults.ts) whenever a store has no active custom template for
 * a given (type, channel) pair - see getEffective(), the only method
 * NotificationService actually depends on for delivery. The admin CRUD
 * methods below are for the Template Management UI (§25).
 */
@Injectable()
export class NotificationTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getEffective(storeId: string, key: NotificationType, channel: NotificationChannel): Promise<DefaultTemplateContent> {
    const custom = await this.prisma.notificationTemplate.findFirst({
      where: { storeId, key, channel, isActive: true, deletedAt: null },
    });
    if (custom) {
      return { subject: custom.subject ?? undefined, title: custom.title ?? key, body: custom.body };
    }
    const fallback = DEFAULT_TEMPLATES[key]?.[channel];
    if (!fallback) {
      throw new NotFoundException(`No template available for ${key}/${channel}`);
    }
    return fallback;
  }

  async findAll(storeId: string) {
    return this.prisma.notificationTemplate.findMany({ where: { storeId, deletedAt: null }, orderBy: [{ key: 'asc' }, { channel: 'asc' }] });
  }

  async findOne(storeId: string, id: string) {
    const template = await this.prisma.notificationTemplate.findFirst({ where: { id, storeId, deletedAt: null } });
    if (!template) {
      throw new NotFoundException('Notification template not found');
    }
    return template;
  }

  async create(storeId: string, actor: AuthenticatedUser, dto: CreateNotificationTemplateDto) {
    try {
      const created = await this.prisma.notificationTemplate.create({
        data: {
          storeId,
          key: dto.key,
          channel: dto.channel,
          subject: dto.subject,
          title: dto.title,
          body: dto.body,
          isActive: dto.isActive ?? true,
        },
      });
      await this.auditLogService.record({
        storeId,
        userId: actor.userId,
        action: 'NOTIFICATION_TEMPLATE_CREATED',
        entityType: 'NotificationTemplate',
        entityId: created.id,
        metadata: { key: dto.key, channel: dto.channel },
      });
      return created;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(`A template for ${dto.key}/${dto.channel} already exists in this store`);
      }
      throw error;
    }
  }

  async update(storeId: string, actor: AuthenticatedUser, id: string, dto: UpdateNotificationTemplateDto) {
    const existing = await this.findOne(storeId, id);
    const updated = await this.prisma.notificationTemplate.update({
      where: { id: existing.id },
      data: { subject: dto.subject, title: dto.title, body: dto.body },
    });
    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'NOTIFICATION_TEMPLATE_UPDATED',
      entityType: 'NotificationTemplate',
      entityId: updated.id,
    });
    return updated;
  }

  async setStatus(storeId: string, actor: AuthenticatedUser, id: string, isActive: boolean) {
    const existing = await this.findOne(storeId, id);
    const updated = await this.prisma.notificationTemplate.update({ where: { id: existing.id }, data: { isActive } });
    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'NOTIFICATION_TEMPLATE_STATUS_CHANGED',
      entityType: 'NotificationTemplate',
      entityId: updated.id,
      metadata: { isActive },
    });
    return updated;
  }

  async remove(storeId: string, actor: AuthenticatedUser, id: string) {
    const existing = await this.findOne(storeId, id);
    await this.prisma.notificationTemplate.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'NOTIFICATION_TEMPLATE_DELETED',
      entityType: 'NotificationTemplate',
      entityId: existing.id,
    });
    return { id: existing.id };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
}
