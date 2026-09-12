import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AppConfig } from '../../../config/configuration';
import { EmailProvider, SendEmailInput } from './email-provider.interface';

/**
 * Real SMTP delivery via nodemailer, configured entirely from environment
 * variables (§10) - never hard-coded credentials, never exposed to the
 * frontend (this class only exists on the API server). Only constructed
 * when EMAIL_ENABLED=true and an SMTP host is configured - see
 * NotificationsModule's provider factory.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly transporter: nodemailer.Transporter;
  private readonly from: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    const email = configService.get('email', { infer: true });
    this.from = `"${email.fromName}" <${email.from}>`;
    this.transporter = nodemailer.createTransport({
      host: email.host,
      port: email.port,
      secure: email.secure,
      auth: email.username ? { user: email.username, pass: email.password } : undefined,
    });
  }

  async send(input: SendEmailInput): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
  }
}
