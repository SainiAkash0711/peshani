import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Liveness vs readiness are deliberately different checks (§53-55):
 * liveness only answers "is this process alive and able to handle a
 * request at all" and must NEVER depend on the database - if it did, a
 * temporary DB blip would make an orchestrator kill and restart otherwise-
 * healthy application instances, which is exactly the wrong response to a
 * dependency outage. Readiness is the one that actually exercises the
 * database, since that's a real prerequisite for serving real traffic.
 *
 * Redis is deliberately NOT checked by either endpoint - it exists in
 * docker-compose but nothing in this application's runtime code uses it
 * (confirmed: no ioredis/redis client anywhere in apps/api/src), so treating
 * it as a required dependency would make the app report unhealthy for a
 * service it never actually calls.
 *
 * Neither endpoint ever returns a database hostname, connection string,
 * stack trace, or any other internal detail - just a minimal status object.
 * `/health` is kept as an alias for `/health/ready` for backward
 * compatibility with existing callers (this project's own live smoke tests
 * from Phase 11/12 already curl it expecting a DB-backed 200/500).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    return this.ready();
  }

  @Public()
  @Get('live')
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', timestamp: new Date().toISOString() };
    } catch {
      throw new HttpException({ status: 'unavailable', timestamp: new Date().toISOString() }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
