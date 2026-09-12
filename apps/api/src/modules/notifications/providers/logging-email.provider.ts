import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider, SendEmailInput } from './email-provider.interface';

/**
 * §10 - "if no SMTP provider is configured, development/test mode must
 * still work without crashing the application." This provider never
 * throws and never actually sends anything over the network - it just logs
 * what WOULD have been sent, at debug level so it doesn't spam normal
 * server logs. Selected automatically whenever EMAIL_ENABLED is false or no
 * SMTP host is configured (see NotificationsModule).
 */
@Injectable()
export class LoggingEmailProvider implements EmailProvider {
  private readonly logger = new Logger(LoggingEmailProvider.name);

  async send(input: SendEmailInput): Promise<void> {
    this.logger.debug(`[dev email] to=${input.to} subject="${input.subject}"`);
  }
}
