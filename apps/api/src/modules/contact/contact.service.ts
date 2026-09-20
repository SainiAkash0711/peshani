import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EMAIL_PROVIDER } from '../notifications/providers/email-provider.tokens';
import { EmailProvider } from '../notifications/providers/email-provider.interface';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';
import { CreateContactReplyDto } from './dto/create-contact-reply.dto';

/**
 * The contact form's one job is to never lose a customer's message - the DB
 * row is written FIRST and is the durable record; emailing the store owner
 * is then attempted best-effort on top of that; per EmailProvider's own
 * contract (see LoggingEmailProvider) this never throws even when SMTP
 * isn't configured (EMAIL_ENABLED=false), so a store that hasn't set up
 * email yet still keeps every submission, just without the alert email.
 */
@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeSettingsService: StoreSettingsService,
    private readonly auditLogService: AuditLogService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async create(storeId: string, dto: CreateContactMessageDto) {
    const saved = await this.prisma.contactMessage.create({
      data: {
        storeId,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        message: dto.message,
      },
    });

    const settings = await this.storeSettingsService.getAllSettings(storeId);
    const recipient = settings.supportEmail;
    if (!recipient) {
      this.logger.warn(`Contact message ${saved.id} saved, but no supportEmail is configured to notify.`);
      return saved;
    }

    try {
      await this.emailProvider.send({
        to: recipient,
        subject: `New contact message from ${dto.name}`,
        text: this.renderText(dto),
        html: this.renderHtml(dto),
      });
      return this.prisma.contactMessage.update({ where: { id: saved.id }, data: { emailSentAt: new Date() } });
    } catch (error) {
      // The message is already safely in the database - a delivery failure
      // here is logged, not thrown, so the customer still sees a normal
      // success response rather than an error for something outside their
      // control.
      this.logger.error(`Failed to email contact message ${saved.id}: ${error}`);
      return saved;
    }
  }

  async findAll(storeId: string, query: PaginationQueryDto) {
    const where = { storeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.contactMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { replies: true } } },
      }),
      this.prisma.contactMessage.count({ where }),
    ]);
    const mapped = items.map(({ _count, ...rest }) => ({ ...rest, replyCount: _count.replies }));
    return paginate(mapped, total, query.page, query.pageSize);
  }

  async findOne(storeId: string, id: string) {
    const message = await this.prisma.contactMessage.findFirst({
      where: { id, storeId },
      include: {
        replies: {
          orderBy: { sentAt: 'asc' },
          include: { sentByUser: { select: { email: true, firstName: true, lastName: true } } },
        },
      },
    });
    if (!message) {
      throw new NotFoundException('Contact message not found');
    }
    return message;
  }

  async remove(storeId: string, id: string, actor: AuthenticatedUser) {
    const existing = await this.getScopedMessageOrThrow(storeId, id);
    await this.prisma.contactMessage.delete({ where: { id: existing.id } });

    await this.auditLogService.record({
      storeId,
      userId: actor.userId,
      action: 'ContactMessageDeleted',
      entityType: 'ContactMessage',
      entityId: existing.id,
      metadata: { before: existing },
    });

    return { id: existing.id };
  }

  /**
   * Same durable-first, best-effort-email-second contract as create(): the
   * reply row is saved regardless of whether the outbound email actually
   * sends, so a reply is never silently lost just because SMTP isn't
   * configured (or the customer's address bounces).
   */
  async reply(storeId: string, id: string, dto: CreateContactReplyDto, actor: AuthenticatedUser) {
    const original = await this.getScopedMessageOrThrow(storeId, id);

    const saved = await this.prisma.contactMessageReply.create({
      data: {
        contactMessageId: original.id,
        message: dto.message,
        sentByUserId: actor.userId,
      },
    });

    const store = await this.storeSettingsService.getDefaultStore();
    try {
      await this.emailProvider.send({
        to: original.email,
        subject: `Re: your message to ${store.name}`,
        text: dto.message,
        html: `<p>${this.escapeHtml(dto.message).replace(/\n/g, '<br>')}</p>`,
      });
      return this.prisma.contactMessageReply.update({ where: { id: saved.id }, data: { emailSentAt: new Date() } });
    } catch (error) {
      this.logger.error(`Failed to email reply ${saved.id} for contact message ${original.id}: ${error}`);
      return saved;
    }
  }

  private async getScopedMessageOrThrow(storeId: string, id: string) {
    const message = await this.prisma.contactMessage.findFirst({ where: { id, storeId } });
    if (!message) {
      throw new NotFoundException('Contact message not found');
    }
    return message;
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private renderText(dto: CreateContactMessageDto): string {
    return [
      `Name: ${dto.name}`,
      `Email: ${dto.email}`,
      dto.phone ? `Phone: ${dto.phone}` : undefined,
      '',
      dto.message,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');
  }

  private renderHtml(dto: CreateContactMessageDto): string {
    const escape = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `
      <p><strong>Name:</strong> ${escape(dto.name)}</p>
      <p><strong>Email:</strong> ${escape(dto.email)}</p>
      ${dto.phone ? `<p><strong>Phone:</strong> ${escape(dto.phone)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p>${escape(dto.message).replace(/\n/g, '<br>')}</p>
    `;
  }
}
