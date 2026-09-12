import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from '../metrics/metrics.service';
import { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';
import { RequestWithId } from '../middleware/request-id.middleware';

const SLOW_REQUEST_THRESHOLD_MS = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS ?? '1000', 10);

/**
 * One structured log line per request (never the request/response body -
 * see §50/§66), plus lightweight metrics with only bounded labels (method,
 * route TEMPLATE, status class - never a raw path with real ids in it,
 * which would be unbounded cardinality, see §52/§83).
 *
 * Route TEMPLATE (not the resolved URL) is read from Express's own
 * `route.path`, populated by the time a handler actually runs - e.g.
 * `/orders/:orderNumber`, not `/orders/PES-20260101-ABCDEF`.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const start = Date.now();
    const method: string = request.method;
    const routeTemplate: string = request.route?.path ? `${request.baseUrl ?? ''}${request.route.path}` : 'unmatched';
    const requestId = (request as RequestWithId).requestId;

    return next.handle().pipe(
      tap({
        next: () => this.finish(request, response, method, routeTemplate, requestId, start),
        error: () => this.finish(request, response, method, routeTemplate, requestId, start),
      }),
    );
  }

  private finish(
    request: { user?: AuthenticatedUser },
    response: { statusCode: number },
    method: string,
    routeTemplate: string,
    requestId: string,
    start: number,
  ): void {
    const durationMs = Date.now() - start;
    const statusCode = response.statusCode;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;

    this.metrics.incrementCounter('http_requests_total', { method, route: routeTemplate, status: statusClass });
    if (statusCode >= 500) {
      this.metrics.incrementCounter('http_request_errors_total', { method, route: routeTemplate });
    }
    this.metrics.recordDuration('http_request_duration_ms', { method, route: routeTemplate }, durationMs);

    const fields = {
      requestId,
      method,
      route: routeTemplate,
      statusCode,
      durationMs,
      storeId: request.user?.storeId,
    };

    if (durationMs >= SLOW_REQUEST_THRESHOLD_MS) {
      this.logger.warn(JSON.stringify({ event: 'SLOW_REQUEST', ...fields }));
    } else {
      this.logger.log(JSON.stringify(fields));
    }
  }
}
