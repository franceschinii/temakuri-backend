import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto, LoginDto, GuestDto } from './dto/auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) throw new BadRequestException('Email already in use');

    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existingUsername) throw new BadRequestException('Username already taken');

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { username: dto.username, email: dto.email, passwordHash, isGuest: false },
    });

    await this.prisma.userStats.create({ data: { userId: user.id } });

    const tokens = await this.generateTokens(user.id, user.username);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return { user: this.sanitizeUser(user), ...tokens };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const tokens = await this.generateTokens(user.id, user.username);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return { user: this.sanitizeUser(user), ...tokens };
  }

  async loginAsGuest(dto: GuestDto) {
    const existingUsername = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (existingUsername) throw new BadRequestException('Username already taken');

    const user = await this.prisma.user.create({
      data: { username: dto.username, isGuest: true },
    });

    await this.prisma.userStats.create({ data: { userId: user.id } });

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, username: user.username },
      { secret: this.config.get('JWT_SECRET'), expiresIn: '4h' },
    );

    return { user: this.sanitizeUser(user), accessToken };
  }

  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({ where: { token: refreshToken } });
    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new UnauthorizedException();

    const tokens = await this.generateTokens(user.id, user.username);
    await this.prisma.session.delete({ where: { token: refreshToken } });
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(refreshToken: string) {
    await this.prisma.session.deleteMany({ where: { token: refreshToken } });
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.sanitizeUser(user);
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Responde igual mesmo se não encontrar — evita enumeração de emails
    if (!user || user.isGuest) return;

    // Invalida tokens anteriores do mesmo usuário
    await this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos
    await this.prisma.passwordResetToken.create({ data: { userId: user.id, token, expiresAt } });

    const frontendUrl = this.config.get('FRONTEND_URL', 'http://localhost:5173');
    const resetLink = `${frontendUrl}/auth/reset-password?token=${token}`;

    await this.sendResetEmail(email, user.username, resetLink);
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { token } });
    if (!record || record.expiresAt < new Date()) {
      throw new BadRequestException('Token inválido ou expirado');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.delete({ where: { token } });
    // Invalidar todas as sessões ativas após troca de senha
    await this.prisma.session.deleteMany({ where: { userId: record.userId } });
  }

  private async sendResetEmail(to: string, username: string, resetLink: string) {
    const transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'smtp.gmail.com'),
      port: Number(this.config.get('SMTP_PORT', '587')),
      secure: this.config.get('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });

    await transporter.sendMail({
      from: `"Temakuri" <${this.config.get('SMTP_USER')}>`,
      to,
      subject: 'Redefinir senha — Temakuri',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="margin-bottom:8px">Olá, ${username}!</h2>
          <p style="color:#666;margin-bottom:24px">
            Recebemos um pedido para redefinir a senha da sua conta no Temakuri.
            O link abaixo expira em <strong>15 minutos</strong>.
          </p>
          <a href="${resetLink}"
            style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Redefinir Senha
          </a>
          <p style="color:#999;font-size:12px;margin-top:24px">
            Se você não solicitou isso, ignore este email.
          </p>
        </div>
      `,
    });
  }

  private async generateTokens(userId: string, username: string) {
    const payload = { sub: userId, username };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string) {
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await this.prisma.session.create({ data: { userId, token, expiresAt } });
  }

  private sanitizeUser(user: any) {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
