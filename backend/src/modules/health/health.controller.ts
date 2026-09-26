import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /** Plain `GET /health` alias of `live`, for smoke tests and load balancers. */
  @Get()
  check() {
    return this.live();
  }

  /** Process is up. Never touches dependencies — used for restart decisions. */
  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Dependencies reachable. Used by Nginx/orchestrator to route traffic. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.db.pingCheck('database', { timeout: 1500 })]);
  }
}
