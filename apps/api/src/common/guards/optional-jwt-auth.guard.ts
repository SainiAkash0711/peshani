import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Runs the same JWT strategy as JwtAuthGuard, but never blocks the request:
 * a missing/invalid/expired Bearer token simply leaves `request.user`
 * undefined instead of throwing. Used on cart routes, which must work for
 * both guests (no token) and authenticated customers (valid token) - the
 * global JwtAuthGuard's @Public() bypass is all-or-nothing and never
 * populates `request.user`, so it can't tell the two cases apart on its own.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
