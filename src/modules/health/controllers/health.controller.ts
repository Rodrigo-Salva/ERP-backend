import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PrismaService } from '../../../database/prisma.service';
import { Public } from '../../../common/auth/authenticated-request';

class LivenessResponse {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

class ReadinessResponse extends LivenessResponse {
  @ApiProperty({ example: 'up' })
  database!: string;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @ApiOperation({ summary: 'Comprueba que el proceso responde' })
  @ApiOkResponse({ type: LivenessResponse })
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  @Get()
  @ApiOperation({ summary: 'Comprueba la conexión con PostgreSQL' })
  @ApiOkResponse({ type: ReadinessResponse })
  @ApiResponse({ status: 503, description: 'Base de datos no disponible' })
  async ready(): Promise<ReadinessResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
