import { IsArray, IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreditDiamondsDto {
  @IsInt()
  @Min(-100_000)
  @Max(100_000)
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}


export class UpdateUserDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  avatarIndex?: number;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  newPassword: string;
}

export class ModerationDto {
  @IsOptional()
  @IsBoolean()
  isBanned?: boolean;

  @IsOptional()
  @IsDateString()
  suspendedUntil?: string | null;
}

export class UpdateStatsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  gamesPlayed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  gamesWon?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  saborTriggers?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  tricksWon?: number;
}

export class UpdateProgressionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  xp?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  level?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  coins?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rankedWarnings?: number;

  @IsOptional()
  @IsBoolean()
  clearRankedSuspension?: boolean;

  @IsOptional()
  @IsBoolean()
  isPremium?: boolean;

  // isAdmin removido intencionalmente: promover/rebaixar admin so via CLI (seed-admin.mjs).
  // Manter esse campo aqui permitiria que qualquer admin escalasse privilegios via API.

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  grantAvatars?: number[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  revokeAvatars?: number[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grantModes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  revokeModes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grantThemes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  revokeThemes?: string[];
}
