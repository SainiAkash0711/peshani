import { Injectable } from '@nestjs/common';

/**
 * Dependency-light, in-process metrics registry - no Prometheus/StatsD
 * client, no external process, just bounded in-memory counters/gauges
 * exposed via GET /admin/diagnostics (permission-gated). Deliberately
 * rejected: Prometheus/Grafana infrastructure, which this phase's own scope
 * explicitly excludes absent a clear existing justification.
 *
 * Label cardinality is bounded by construction: every counter/histogram key
 * is built ONLY from a small fixed vocabulary (HTTP method, a route
 * TEMPLATE like `/orders/:orderNumber` - never the resolved path with a real
 * order number in it, a status-code class like `2xx`/`4xx`/`5xx`, or a fixed
 * business-event name like `refund_unknown`). Nothing derived from request
 * content (userId, orderId, requestId, a search query, an email, an IP) is
 * ever used as a label - doing so would let an attacker or a large catalog
 * grow this process's memory unboundedly.
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durationSumMs = new Map<string, number>();
  private readonly durationCount = new Map<string, number>();

  incrementCounter(name: string, labels: Record<string, string> = {}): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  recordDuration(name: string, labels: Record<string, string>, durationMs: number): void {
    const key = this.key(name, labels);
    this.durationSumMs.set(key, (this.durationSumMs.get(key) ?? 0) + durationMs);
    this.durationCount.set(key, (this.durationCount.get(key) ?? 0) + 1);
  }

  /** Snapshot for the admin diagnostics endpoint - counters, plus average duration per label combination. */
  snapshot(): {
    counters: Record<string, number>;
    averageDurationMs: Record<string, number>;
  } {
    const averageDurationMs: Record<string, number> = {};
    for (const [key, sum] of this.durationSumMs.entries()) {
      const count = this.durationCount.get(key) ?? 1;
      averageDurationMs[key] = Math.round((sum / count) * 100) / 100;
    }
    return {
      counters: Object.fromEntries(this.counters),
      averageDurationMs,
    };
  }

  private key(name: string, labels: Record<string, string>): string {
    const labelPart = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return labelPart ? `${name}{${labelPart}}` : name;
  }
}
