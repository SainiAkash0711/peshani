import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { RolesService } from './roles.service';

@ApiTags('roles')
@UseGuards(PermissionsGuard)
@Controller()
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Permissions('roles.manage')
  @Get('roles')
  async listRoles(@CurrentUser() currentUser: AuthenticatedUser) {
    return this.rolesService.listRoles(currentUser.storeId);
  }

  @Permissions('roles.manage')
  @Get('permissions')
  async listPermissions() {
    return this.rolesService.listPermissions();
  }
}
