import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UsersService } from './users.service';

@ApiTags('users')
@UseGuards(PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Permissions('users.manage')
  @Get()
  async list(
    @CurrentUser() currentUser: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.usersService.listByStore(
      currentUser.storeId,
      page ? parseInt(page, 10) : undefined,
      pageSize ? parseInt(pageSize, 10) : undefined,
    );
  }

  @Permissions('users.manage')
  @Get(':id')
  async findOne(@CurrentUser() currentUser: AuthenticatedUser, @Param('id') id: string) {
    return this.usersService.findById(currentUser.storeId, id);
  }
}
