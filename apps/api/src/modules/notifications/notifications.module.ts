import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { OutboxService } from './outbox.service';
import { TemplateRendererService } from './template-renderer.service';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationService } from './notification.service';
import { OutboxWorkerService } from './outbox-worker.service';
import { EmailDeliveryWorkerService } from './email-delivery-worker.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { AdminNotificationsController } from './admin-notifications.controller';
import { AdminNotificationTemplatesController } from './admin-notification-templates.controller';
import { EMAIL_PROVIDER } from './providers/email-provider.tokens';
import { SmtpEmailProvider } from './providers/smtp-email.provider';
import { LoggingEmailProvider } from './providers/logging-email.provider';

/**
 * §9/§10 - EMAIL_PROVIDER resolves to a real SMTP transport only when
 * EMAIL_ENABLED=true AND an SMTP host is actually configured; otherwise the
 * safe logging-only fallback is used, so this module (and therefore the
 * whole application, since OrdersModule/PaymentsModule/ReviewsModule all
 * import it) never fails to start or crashes at runtime for lack of SMTP
 * credentials - required for this environment, which has none configured.
 */
@Module({
  controllers: [NotificationsController, NotificationPreferencesController, AdminNotificationsController, AdminNotificationTemplatesController],
  providers: [
    OutboxService,
    TemplateRendererService,
    NotificationTemplateService,
    NotificationPreferenceService,
    NotificationService,
    OutboxWorkerService,
    EmailDeliveryWorkerService,
    {
      provide: EMAIL_PROVIDER,
      useFactory: (configService: ConfigService<AppConfig, true>, smtp: SmtpEmailProvider, logging: LoggingEmailProvider) => {
        const email = configService.get('email', { infer: true });
        return email.enabled && email.host ? smtp : logging;
      },
      inject: [ConfigService, SmtpEmailProvider, LoggingEmailProvider],
    },
    SmtpEmailProvider,
    LoggingEmailProvider,
  ],
  exports: [
    OutboxService,
    NotificationService,
    NotificationTemplateService,
    NotificationPreferenceService,
    OutboxWorkerService,
    EmailDeliveryWorkerService,
    EMAIL_PROVIDER,
  ],
})
export class NotificationsModule {}
