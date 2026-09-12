import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AppConfig } from '../../config/configuration';
import { parseDurationToMs } from '../../common/utils/duration.util';
import { CartService, MergeResult } from '../cart/cart.service';
import { SecurityEventsService } from '../../common/security/security-events.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AuthenticatedUser } from './types/authenticated-user.type';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from './jwt.constants';

const DEFAULT_CUSTOMER_ROLE = 'CUSTOMER';
const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  // Present only when the login request carried a guest cart token that
  // actually matched an ACTIVE, non-empty guest cart - see mergeGuestCartIntoUser().
  cartMerge?: MergeResult;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly auditLogService: AuditLogService,
    private readonly cartService: CartService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async register(storeId: string, dto: RegisterDto, ipAddress?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { storeId_email: { storeId, email: dto.email.toLowerCase() } },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          storeId,
          email: dto.email.toLowerCase(),
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
        },
      });

      const customerRole = await tx.role.findUnique({
        where: { storeId_name: { storeId, name: DEFAULT_CUSTOMER_ROLE } },
      });
      if (customerRole) {
        await tx.userRole.create({
          data: { userId: created.id, roleId: customerRole.id },
        });
      }

      return created;
    });

    await this.auditLogService.record({
      storeId,
      userId: user.id,
      action: 'REGISTER',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    const verificationToken = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'email_verify' },
      {
        secret: this.configService.get('jwt', { infer: true }).accessSecret,
        expiresIn: '1d',
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );

    // STUB: real delivery happens once the Notifications module (Phase 6) lands.
    // Never log the raw token value itself (see §39/PII-logging policy) -
    // only that one was issued. In non-production, `devVerificationToken`
    // below still exposes the real value for local/test workflows.
    this.logger.debug(`Email verification token issued for user ${user.id}`);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      ...(this.configService.get('nodeEnv', { infer: true }) !== 'production'
        ? { devVerificationToken: verificationToken }
        : {}),
    };
  }

  async login(
    storeId: string,
    dto: LoginDto,
    context: { ipAddress?: string; userAgent?: string },
    guestCartToken?: string,
  ): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({
      where: { storeId_email: { storeId, email: dto.email.toLowerCase() } },
    });

    // Constant-shape error regardless of which check fails, to avoid user enumeration.
    if (!user || !user.isActive) {
      this.securityEvents.emit('LOGIN_FAILURE', { storeId, reason: 'no_such_user_or_inactive' });
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      this.securityEvents.emit('LOGIN_FAILURE', { storeId, userId: user.id, reason: 'bad_password' });
      throw new UnauthorizedException('Invalid email or password');
    }

    const authenticatedUser = await this.buildAuthenticatedUser(user.id, storeId, user.email, user.type);
    const tokens = await this.issueTokenPair(authenticatedUser, context);
    this.securityEvents.emit('LOGIN_SUCCESS', { storeId, userId: user.id });

    await this.auditLogService.record({
      storeId,
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress: context.ipAddress,
    });

    // Guest -> customer cart merge happens once, right here, at the exact
    // moment a browser session's identity changes from anonymous to known -
    // see CartService.mergeGuestCartIntoUser() for the full merge rules.
    // Never fails the login itself if merging has a problem.
    let cartMerge: MergeResult | null = null;
    if (guestCartToken) {
      try {
        cartMerge = await this.cartService.mergeGuestCartIntoUser(storeId, user.id, guestCartToken);
      } catch (error) {
        this.logger.warn(`Guest cart merge failed for user ${user.id}: ${(error as Error).message}`);
      }
    }

    return { ...tokens, ...(cartMerge ? { cartMerge } : {}) };
  }

  async refresh(rawRefreshToken: string, context: { ipAddress?: string; userAgent?: string }): Promise<IssuedTokens> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      this.securityEvents.emit('REFRESH_FAILURE', { reason: 'not_found' });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Reuse detection: `replacedBy` is only ever set by THIS method's own
    // rotation step below (never by logout/password-reset, which revoke
    // without setting it) - so a revoked token that also carries a
    // `replacedBy` value means someone is presenting a token that was
    // already rotated forward. That's the signature of a stolen refresh
    // token being replayed after the legitimate client already rotated past
    // it - the standard response is to burn the entire token family (every
    // refresh token for this user), since we can no longer tell which of
    // the two holders is legitimate.
    if (existing.revokedAt && existing.replacedBy) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.securityEvents.emit('REFRESH_REUSE_DETECTED', { userId: existing.userId });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (existing.revokedAt || existing.expiresAt < new Date()) {
      this.securityEvents.emit('REFRESH_FAILURE', { userId: existing.userId, reason: existing.revokedAt ? 'revoked' : 'expired' });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: existing.userId } });
    if (!user || !user.isActive) {
      this.securityEvents.emit('REFRESH_FAILURE', { userId: existing.userId, reason: 'user_inactive' });
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const authenticatedUser = await this.buildAuthenticatedUser(user.id, user.storeId, user.email, user.type);
    const tokens = await this.issueTokenPair(authenticatedUser, context);

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: this.hashToken(tokens.refreshToken) },
    });
    this.securityEvents.emit('REFRESH_SUCCESS', { userId: user.id });

    return tokens;
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every refresh token for the given user - "log out everywhere". Used both by the explicit logout-all endpoint and as the reuse-detection response above. */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyEmail(token: string): Promise<void> {
    const payload = await this.verifyPurposeToken(token, 'email_verify');
    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { emailVerifiedAt: new Date() },
    });
    this.securityEvents.emit('EMAIL_VERIFICATION_COMPLETED', { userId: payload.sub });
  }

  async forgotPassword(storeId: string, email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { storeId_email: { storeId, email: email.toLowerCase() } },
    });
    // Always respond as if successful - do not reveal whether the email exists.
    if (!user) return;

    const resetToken = await this.jwtService.signAsync(
      { sub: user.id, purpose: 'password_reset', jti: randomUUID() },
      {
        secret: this.configService.get('jwt', { infer: true }).accessSecret,
        expiresIn: '1h',
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );

    // Never log the raw token value (§39) - only that one was issued.
    this.logger.debug(`Password reset token issued for user ${user.id}`);
    this.securityEvents.emit('PASSWORD_RESET_REQUESTED', { storeId, userId: user.id });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const payload = await this.verifyPurposeToken(token, 'password_reset');
    if (!payload.jti) {
      // A token signed before this single-use tracking existed, or missing
      // its jti for any other reason - reject rather than silently allow
      // unlimited reuse of an otherwise-still-valid signature.
      throw new UnauthorizedException('Invalid or expired token');
    }
    const passwordHash = await argon2.hash(newPassword);

    try {
      await this.prisma.$transaction([
        // Fails with a unique-constraint violation if this jti was already
        // redeemed - makes the whole reset atomically single-use rather
        // than a stateless JWT that stays valid for its full 1h expiry no
        // matter how many times it's been used.
        this.prisma.usedPasswordResetToken.create({ data: { jti: payload.jti, userId: payload.sub } }),
        this.prisma.user.update({ where: { id: payload.sub }, data: { passwordHash } }),
        // Reset password -> revoke every existing session for this user.
        this.prisma.refreshToken.updateMany({
          where: { userId: payload.sub, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
        throw new UnauthorizedException('This password reset link has already been used');
      }
      throw error;
    }
    this.securityEvents.emit('PASSWORD_RESET_COMPLETED', { userId: payload.sub });
  }

  private async verifyPurposeToken(token: string, purpose: string): Promise<{ sub: string; jti?: string }> {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; purpose: string; jti?: string }>(token, {
        secret: this.configService.get('jwt', { infer: true }).accessSecret,
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (payload.purpose !== purpose) {
        throw new UnauthorizedException('Invalid token');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private async buildAuthenticatedUser(
    userId: string,
    storeId: string,
    email: string,
    type: 'CUSTOMER' | 'ADMIN',
  ): Promise<AuthenticatedUser> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(userRoles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.key))),
    );

    return { userId, storeId, email, type, roles, permissions };
  }

  private async issueTokenPair(
    user: AuthenticatedUser,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<IssuedTokens> {
    const jwtConfig = this.configService.get('jwt', { infer: true });

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.userId,
        storeId: user.storeId,
        email: user.email,
        type: user.type,
        roles: user.roles,
        permissions: user.permissions,
      },
      {
        secret: jwtConfig.accessSecret,
        expiresIn: jwtConfig.accessExpiresIn,
        algorithm: JWT_ALGORITHM,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      },
    );

    const rawRefreshToken = randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + parseDurationToMs(jwtConfig.refreshExpiresIn));

    await this.prisma.refreshToken.create({
      data: {
        userId: user.userId,
        tokenHash: this.hashToken(rawRefreshToken),
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  // storeId is always taken from the authenticated JWT, never a client
  // input - the same tenant-isolation pattern used throughout this codebase
  // (e.g. UsersService.findById) - so one store's customer can never read
  // or edit another store's user row even if they somehow guessed a userId.
  async getProfile(storeId: string, userId: string) {
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id: userId, storeId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        address: true,
      },
    });
    return user;
  }

  async updateProfile(storeId: string, userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.findFirstOrThrow({ where: { id: userId, storeId } });

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.dateOfBirth !== undefined && { dateOfBirth: new Date(dto.dateOfBirth) }),
        ...(dto.gender !== undefined && { gender: dto.gender }),
        ...(dto.address !== undefined && { address: dto.address as Prisma.InputJsonValue }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        address: true,
      },
    });
    return user;
  }
}
