import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface RecordOutboxEventInput {
  storeId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  /** Deterministic, e.g. "ORDER_CONFIRMED:<orderId>" - see OutboxEvent's own doc comment in schema.prisma. */
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

/**
 * §30/§31 - the write side of the transactional outbox. Call sites (see
 * OrderStatusService, PaymentService, ReviewsService) pass their own `tx`
 * (the SAME Prisma.TransactionClient already committing the business state
 * change) so the OutboxEvent row is durably created together with that
 * change, in one atomic commit - a process crash immediately after commit
 * can never lose the event, and a rollback of the business transaction
 * takes the OutboxEvent row with it (never a false notification for a
 * change that didn't actually happen - §33).
 *
 * A duplicate call for the same idempotencyKey (e.g. a retried webhook
 * re-entering the same code path) is a safe, silent no-op - the unique
 * constraint on OutboxEvent.idempotencyKey does the real work here, exactly
 * like every other idempotency guarantee in this codebase.
 */
@Injectable()
export class OutboxService {
  async record(tx: Prisma.TransactionClient, input: RecordOutboxEventInput): Promise<void> {
    try {
      await tx.outboxEvent.create({
        data: {
          storeId: input.storeId,
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          idempotencyKey: input.idempotencyKey,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === PRISMA_UNIQUE_CONSTRAINT_ERROR;
}
