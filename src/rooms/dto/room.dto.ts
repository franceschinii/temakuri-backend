import { IsString, IsIn, IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';
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
}
