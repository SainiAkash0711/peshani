import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StoreSettingsService } from '../store-settings/store-settings.service';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthenticatedUser } from './types/authenticated-user.type';
import { throttleLimit } from '../../common/utils/throttle.util';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly storeSettingsService: StoreSettingsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: throttleLimit(5), ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.authService.register(store.id, dto, req.ip);
  }

  @Public()
  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Headers('x-guest-cart-token') guestCartToken?: string,
  ) {
    const store = await this.storeSettingsService.getDefaultStore();
    return this.authService.login(
      store.id,
      dto,
      { ipAddress: req.ip, userAgent: req.headers['user-agent'] },
      guestCartToken,
    );
  }

  @Public()
  @Throttle({ default: { limit: throttleLimit(30), ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logoutAll(user.userId);
  }

  @Public()
  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: throttleLimit(5), ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const store = await this.storeSettingsService.getDefaultStore();
    await this.authService.forgotPassword(store.id, dto.email);
  }

  @Public()
  @Throttle({ default: { limit: throttleLimit(10), ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.storeId, user.userId);
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user.storeId, user.userId, dto);
  }
}
