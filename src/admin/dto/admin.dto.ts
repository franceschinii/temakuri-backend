import { IsBoolean, IsDateString, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

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
