import { IsString, IsIn, IsInt, IsNumber, Min, Max, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRoomDto {
  @ApiProperty({ enum: ['TRADITIONAL', 'MERCADO', 'RODIZIO', 'DEGUSTACAO'] })
  @IsIn(['TRADITIONAL', 'MERCADO', 'RODIZIO', 'DEGUSTACAO'])
  mode: string;

  @ApiProperty({ minimum: 2, maximum: 6 })
  @IsInt()
  @Min(2)
  @Max(6)
  maxPlayers: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrivate?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 1, description: 'Hand bias: 0 = random, 1 = max grouping' })
  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  handBias?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 3, description: 'Initial tokens (lives) per player' })
  @IsInt()
  @Min(1)
  @Max(3)
  @IsOptional()
  initialTokens?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isRanked?: boolean;
}
