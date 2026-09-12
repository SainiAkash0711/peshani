import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { ReturnRequestService } from './return-request.service';
import { ReturnEvidenceService } from './return-evidence.service';
import { CreateReturnRequestDto } from './dto/create-return-request.dto';
import { QueryReturnsDto } from './dto/query-returns.dto';

const MULTER_HARD_CEILING_BYTES = 20 * 1024 * 1024;

/**
 * §28/§29/§41 - no @Public() anywhere. storeId/userId always come from the
 * JWT via @CurrentUser(), never the client - the create DTO does not even
 * declare userId/storeId/refundAmount/orderStatus/paymentStatus/
 * returnStatus fields, so `forbidNonWhitelisted` rejects any attempt to
 * send one outright.
 */
@ApiTags('returns')
@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly returnRequestService: ReturnRequestService,
    private readonly returnEvidenceService: ReturnEvidenceService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReturnRequestDto) {
    return this.returnRequestService.create(user.storeId, user, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryReturnsDto) {
    return this.returnRequestService.findAllForCustomer(user.storeId, user.userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returnRequestService.findOneForCustomer(user.storeId, user.userId, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.returnRequestService.cancel(user.storeId, user.userId, id);
  }

  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MULTER_HARD_CEILING_BYTES, files: 1 } }))
  @Post(':id/evidence')
  uploadEvidence(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.returnEvidenceService.upload(user.storeId, user, id, file);
  }
}
