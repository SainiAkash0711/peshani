import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedUser } from '../types/authenticated-user.type';
import { JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER } from '../jwt.constants';

interface AccessTokenPayload {
  sub: string;
  storeId: string;
  email: string;
  type: 'CUSTOMER' | 'ADMIN';
  roles: string[];
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt', { infer: true }).accessSecret,
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return {
      userId: payload.sub,
      storeId: payload.storeId,
      email: payload.email,
      type: payload.type,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  }
}
