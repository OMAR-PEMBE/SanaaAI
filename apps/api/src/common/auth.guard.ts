import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError } from './http.js';
import { AuthService, type AuthUser } from '../auth/auth.service.js';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthedRequest = {
  headers: { authorization?: string };
  user?: AuthUser;
  ip?: string;
  socket?: { remoteAddress?: string };
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'TOKEN_INVALID', 'Sign in again.');
    }
    request.user = await this.auth.authenticate(header.slice('Bearer '.length).trim());
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (request.user?.role !== 'admin') {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this.');
    }
    return true;
  }
}
