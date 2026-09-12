import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLogService } from '../../modules/audit-log/audit-log.service';
import { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Automatically audit-logs mutating admin requests, so every later module
 * (catalog, orders, settings, ...) gets an audit trail for free instead of
 * each controller having to call AuditLogService by hand.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditLogService: AuditLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;

    const shouldAudit = user?.type === 'ADMIN' && MUTATING_METHODS.has(request.method);

    return next.handle().pipe(
      tap(() => {
        if (!shouldAudit) return;
        void this.auditLogService.record({
          storeId: user!.storeId,
          userId: user!.userId,
          action: `${request.method} ${request.route?.path ?? request.url}`,
          entityType: context.getClass().name,
          ipAddress: request.ip,
        });
      }),
    );
  }
}
