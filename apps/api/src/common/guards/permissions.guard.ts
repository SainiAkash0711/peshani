import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedUser } from '../../modules/auth/types/authenticated-user.type';
import { SecurityEventsService } from '../security/security-events.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    const user: AuthenticatedUser = context.switchToHttp().getRequest().user;
    // Every route this guard protects is an admin-management endpoint (see
    // the Phase 13 audit - no customer-facing route uses @Permissions()).
    // Nothing in this codebase currently assigns a permission to a CUSTOMER-
    // type account, so this `type` check is defense-in-depth against a
    // future role-assignment feature accidentally granting a permission
    // string to a non-admin account - it should never actually change
    // behavior for any account that exists today.
    const allowed =
      !!user && user.type === 'ADMIN' && requiredPermissions.every((permission) => user.permissions.includes(permission));
    if (!allowed && user) {
      this.securityEvents.emit('AUTHORIZATION_DENIED', {
        userId: user.userId,
        storeId: user.storeId,
        requiredPermissions: requiredPermissions.join(','),
      });
    }
    return allowed;
  }
}
