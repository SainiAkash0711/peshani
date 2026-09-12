import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics/metrics.service';
import { SecurityEventsService } from './security/security-events.service';

/**
 * Cross-cutting, dependency-free infrastructure (metrics, security-event
 * logging) that many otherwise-unrelated modules need to inject - global so
 * every module can use `MetricsService`/`SecurityEventsService` without each
 * one separately importing this module.
 */
@Global()
@Module({
  providers: [MetricsService, SecurityEventsService],
  exports: [MetricsService, SecurityEventsService],
})
export class CommonModule {}
