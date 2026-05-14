import { IsString, IsInt, MinLength, MaxLength, IsOptional, Min, Max } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @IsOptional()
  username?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @Max(14)
  @IsOptional()
  avatarIndex?: number;
}
