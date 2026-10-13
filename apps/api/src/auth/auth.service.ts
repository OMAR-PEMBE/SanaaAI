import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@sanaaai/db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ApiError, securityLog } from '../common/http.js';
import { PrismaService } from '../core/prisma.service.js';

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  sessionVersion: number;
  createdAt: Date;
};

const INVALID = new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

@Injectable()
export class AuthService {
  private dummyHash: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private cost(): number {
    const raw = Number(this.config.get<string>('PASSWORD_HASH_COST') ?? 12);
    return Number.isInteger(raw) && raw >= 10 && raw <= 14 ? raw : 12;
  }

  private ttl(): jwt.SignOptions['expiresIn'] {
    return (this.config.get<string>('JWT_ACCESS_TOKEN_TTL') ?? '15m') as jwt.SignOptions['expiresIn'];
  }

  private secret(): string {
    return this.config.getOrThrow<string>('JWT_SECRET');
  }

  private async dummy(): Promise<string> {
    this.dummyHash ??= await bcrypt.hash('not-a-real-password', this.cost());
    return this.dummyHash;
  }

  private tokenFor(user: { id: string; sessionVersion: number }): string {
    return jwt.sign({ sub: user.id, sv: user.sessionVersion }, this.secret(), { expiresIn: this.ttl() });
  }

  present(user: AuthUser) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async register(input: { fullName: string; email: string; password: string }) {
    const passwordHash = await bcrypt.hash(input.password, this.cost());
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            fullName: input.fullName.trim(),
            email: input.email.trim(),
            passwordHash,
          },
        });
        await tx.wallet.create({ data: { userId: created.id } });
        return created;
      });
      return {
        user: this.present(user),
        accessToken: this.tokenFor(user),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError(409, 'EMAIL_TAKEN', 'An account with that email already exists.');
      }
      throw error;
    }
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim() } });
    const hash = user?.passwordHash ?? (await this.dummy());
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches || user.status !== 'active') {
      securityLog('login_failure', { knownAccount: Boolean(user) });
      throw INVALID;
    }
    return { user: this.present(user), accessToken: this.tokenFor(user) };
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim() } });
    if (!user || user.status !== 'active') return;
    const token = randomBytes(32).toString('base64url');
    const passwordResetTokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const link = `${this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'}/reset-password?token=${token}`;
    if (this.config.get<string>('NODE_ENV') === 'development') {
      console.info(JSON.stringify({ level: 'info', event: 'password_reset_link', link }));
      return;
    }
    if (!this.config.get<string>('SMTP_HOST')) {
      securityLog('password_reset_not_sent', { userId: user.id });
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordResetTokenHash = createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetTokenHash,
        passwordResetExpiresAt: { gt: new Date() },
        status: 'active',
      },
    });
    if (!user) throw new ApiError(400, 'VALIDATION_ERROR', 'This reset link is invalid or expired.');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(newPassword, this.cost()),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        sessionVersion: { increment: 1 },
      },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, this.cost()),
        sessionVersion: { increment: 1 },
      },
    });
    return { user: this.present(updated), accessToken: this.tokenFor(updated) };
  }

  async authenticate(token: string): Promise<AuthUser> {
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, this.secret());
      if (typeof verified === 'string') throw new Error('bad');
      payload = verified;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new ApiError(401, 'TOKEN_EXPIRED', 'Your session expired. Sign in again.');
      }
      throw new ApiError(401, 'TOKEN_INVALID', 'Sign in again.');
    }
    if (typeof payload.sub !== 'string' || typeof payload.sv !== 'number') {
      throw new ApiError(401, 'TOKEN_INVALID', 'Sign in again.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active' || user.sessionVersion !== payload.sv) {
      throw new ApiError(401, 'TOKEN_INVALID', 'Sign in again.');
    }
    return user;
  }
}
