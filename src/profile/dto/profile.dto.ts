import { IsString, IsInt, MinLength, MaxLength, IsOptional, IsIn } from 'class-validator';
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
  @IsIn([0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15])
  @IsOptional()
  avatarIndex?: number;
}
