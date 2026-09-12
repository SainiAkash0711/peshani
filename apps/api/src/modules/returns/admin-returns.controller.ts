import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReturnStatus } from '@prisma/client';
import { IsIn } from 'class-validator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { AdminReturnsService } from './admin-returns.service';
import { ReturnStatusService } from './return-status.service';
import { RefundService } from './refund.service';
import { QueryAdminReturnsDto } from './dto/query-admin-returns.dto';
import { ApproveReturnDto } from './dto/approve-return.dto';
import { RejectReturnDto } from './dto/reject-return.dto';
import { InspectReturnDto } from './dto/inspect-return.dto';

const GENERIC_TARGETS: ReturnStatus[] = ['UNDER_REVIEW', 'IN_TRANSIT'];

class SetReturnStatusDto {
  @IsIn(GENERIC_TARGETS)
  status!: ReturnStatus;
}

@ApiTags('admin-returns')
@UseGuards(PermissionsGuard)
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(
    private readonly adminReturnsService: AdminReturnsService,
    private readonly returnStatusService: ReturnStatusService,
    private readonly refundService: RefundService,
  ) {}

  @Permissions('return.read')
  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryAdminReturnsDto) {
    return this.adminReturnsService.findAll(user.storeId, query);
  }

  @Permissions('return.read')
  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.adminReturnsService.findOne(user.storeId, id);
  }

  /** §30/§33 - restricted to the two safe, side-effect-free generic transitions (UNDER_REVIEW, IN_TRANSIT); every other transition has its own dedicated, validated action below. */
  @Permissions('return.update')
  @Patch(':id/status')
  setStatus(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetReturnStatusDto) {
    return this.returnStatusService.transition(user.storeId, user, id, dto.status);
  }

  @Permissions('return.approve')
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ApproveReturnDto) {
    return this.returnStatusService.approve(user.storeId, user, id, dto);
  }

  @Permissions('return.reject')
  @Post(':id/reject')
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectReturnDto) {
    return this.returnStatusService.reject(user.storeId, user, id, dto);
  }

  @Permissions('return.receive')
  @Post(':id/received')
  markReceived(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returnStatusService.markReceived(user.storeId, user, id);
  }

  @Permissions('return.inspect')
  @Post(':id/inspect')
  inspect(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InspectReturnDto) {
    return this.returnStatusService.inspect(user.storeId, user, id, dto);
  }

  @Permissions('refund.create')
  @Post(':id/refund')
  refund(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.refundService.initiate(user.storeId, user, id);
  }

  @Permissions('refund.manage')
  @Post('refunds/:refundId/recover')
  recoverRefund(@CurrentUser() user: AuthenticatedUser, @Param('refundId', ParseUUIDPipe) refundId: string) {
    return this.refundService.recover(user.storeId, user, refundId);
  }
}
