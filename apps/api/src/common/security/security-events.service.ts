import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'REFRESH_SUCCESS'
  | 'REFRESH_FAILURE'
  | 'REFRESH_REUSE_DETECTED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'EMAIL_VERIFICATION_COMPLETED'
  | 'AUTHORIZATION_DENIED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'WEBHOOK_SIGNATURE_INVALID';

/** WARN-or-above events are never sampled/dropped, regardless of any future log-volume sampling this app might add for high-frequency routes - see §82 of the phase spec. */
const SEVERITY: Record<SecurityEventType, 'info' | 'warn'> = {
  LOGIN_SUCCESS: 'info',
  LOGIN_FAILURE: 'warn',
  REFRESH_SUCCESS: 'info',
  REFRESH_FAILURE: 'warn',
  REFRESH_REUSE_DETECTED: 'warn',
  PASSWORD_RESET_REQUESTED: 'info',
  PASSWORD_RESET_COMPLETED: 'info',
  EMAIL_VERIFICATION_COMPLETED: 'info',
  AUTHORIZATION_DENIED: 'warn',
  RATE_LIMIT_EXCEEDED: 'warn',
  WEBHOOK_SIGNATURE_INVALID: 'warn',
};

/**
 * Structured security-event emission, separate from AuditLogService (which
 * records business-mutation history for admin/compliance review). These are
 * operational signals meant for a log aggregator / future alerting
 * pipeline - never passwords, tokens, or full request bodies, only
 * identifiers and outcome. Never logs an email address directly for
 * anonymous pre-auth events (login/refresh failures) - only a storeId and
 * the event type, since an email is exactly the kind of value that must
 * never become a high-cardinality metric label (§83) or a routinely-logged
 * PII field without operational justification (§39).
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('SecurityEvent');

  constructor(private readonly metrics: MetricsService) {}

  emit(event: SecurityEventType, fields: Record<string, string | undefined> = {}): void {
    const severity = SEVERITY[event];
    const safeFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const entry = { event, ...safeFields };
    if (severity === 'warn') {
      this.logger.warn(JSON.stringify(entry));
    } else {
      this.logger.log(JSON.stringify(entry));
    }
    this.metrics.incrementCounter('security_events_total', { event });
  }
}
