import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { DiagnosticsService } from './diagnostics.service';

/**
 * Minimal admin operational-diagnostics surface (§77-78) - outbox/email
 * backlog depth and age, plus a lightweight in-process metrics snapshot.
 * Never exposes secrets, raw logs, or another store's data: outbox/
 * notification counts are scoped to the caller's own store; the metrics
 * snapshot is process-wide operational data (request counts/latencies),
 * not customer or business data, so it carries no cross-tenant
 * confidentiality concern.
 */
@ApiTags('admin-diagnostics')
@UseGuards(PermissionsGuard)
@Controller('admin/diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @Permissions('diagnostics.read')
  @Get()
  async snapshot(@CurrentUser() user: AuthenticatedUser) {
    return this.diagnosticsService.getSnapshot(user.storeId);
  }
}
