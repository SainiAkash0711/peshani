import { ConflictException } from '@nestjs/common';

/**
 * Thrown by InventoryService.consume() when a reservation's expiresAt has
 * already passed at the moment of commit - distinguishable (via instanceof)
 * from a generic ConflictException so PaymentService can tell "this payment
 * arrived too late for its hold" apart from every other conflict, and react
 * by NOT silently confirming an order with no real inventory behind it (see
 * the Phase 5 correction report §7/§18).
 */
export class ReservationExpiredException extends ConflictException {
  constructor(reservationId: string) {
    super(`Reservation ${reservationId} expired before it could be committed`);
  }
}
