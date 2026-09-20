import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/utils/pagination.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { EMAIL_PROVIDER } from '../notifications/providers/email-provider.tokens';
import { EmailProvider } from '../notifications/providers/email-provider.interface';
import { CreateContactMessageDto } from './dto/create-contact-message.dto';

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
      }),
      this.prisma.contactMessage.count({ where }),
    ]);
    return paginate(items, total, query.page, query.pageSize);
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
