import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController(
    {} as unknown as HealthCheckService,
    {} as unknown as TypeOrmHealthIndicator,
  );

  it('live reports ok with the process uptime', () => {
    const res = controller.live();
    expect(res.status).toBe('ok');
    expect(res.uptime).toBeGreaterThan(0);
  });

  it('GET /health answers like live without touching the database', () => {
    expect(controller.check().status).toBe('ok');
  });
});
