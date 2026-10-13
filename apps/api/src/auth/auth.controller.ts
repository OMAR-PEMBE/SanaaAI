import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../common/auth.guard.js';
import { parseBody } from '../common/http.js';
import { RedisService } from '../core/redis.service.js';
import { AuthService } from './auth.service.js';

const password = z.string().min(8, 'Use at least 8 characters.').max(72);
const credentials = z.object({
  email: z.string().trim().email('Enter a valid email.').max(200),
  password,
});

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function limit(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() req: Request) {
    await this.redis.consume('register', clientIp(req), limit('RATE_LIMIT_REGISTER_PER_MINUTE', 5), 60);
    const input = parseBody(
      credentials.extend({ fullName: z.string().trim().min(1, 'Enter your name.').max(120) }),
      body,
    );
    return { data: await this.auth.register(input) };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    await this.redis.consume('login', clientIp(req), limit('RATE_LIMIT_LOGIN_PER_MINUTE', 10), 60);
    const input = parseBody(credentials, body);
    return { data: await this.auth.login(input.email, input.password) };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request & { user: { id: string } }) {
    await this.auth.logout(req.user.id);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(200)
  async forgot(@Body() body: unknown, @Req() req: Request) {
    await this.redis.consume('forgot', clientIp(req), limit('RATE_LIMIT_FORGOT_PER_MINUTE', 5), 60);
    const input = parseBody(z.object({ email: z.string().trim().email().max(200) }), body);
    await this.auth.forgotPassword(input.email);
    return { data: { message: 'If that email exists, a reset link has been sent.' } };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body() body: unknown) {
    const input = parseBody(z.object({ token: z.string().min(20), newPassword: password }), body);
    await this.auth.resetPassword(input.token, input.newPassword);
    return { data: { message: 'Your password has been updated.' } };
  }

  @Post('password/change')
  @HttpCode(200)
  async change(@Body() body: unknown, @Req() req: Request & { user: { id: string } }) {
    const input = parseBody(
      z.object({ currentPassword: z.string().min(1), newPassword: password }),
      body,
    );
    return { data: await this.auth.changePassword(req.user.id, input.currentPassword, input.newPassword) };
  }

  @Get('me')
  me(@Req() req: Request & { user: Parameters<AuthService['present']>[0] }) {
    return { data: this.auth.present(req.user) };
  }
}
