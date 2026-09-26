import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../modules/users/user.entity';
import { JwtPayload } from '../decorators/current-user.decorator';

function contextWithUser(user?: JwtPayload): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);
  const staff: JwtPayload = { sub: 'u1', email: 'staff@hotel.com', role: UserRole.STAFF };

  afterEach(() => jest.restoreAllMocks());

  it('allows any request when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextWithUser())).toBe(true);
  });

  it('allows a user whose role is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.STAFF, UserRole.ADMIN]);
    expect(guard.canActivate(contextWithUser(staff))).toBe(true);
  });

  it('rejects a user whose role is not required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(contextWithUser(staff))).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(ForbiddenException);
  });
});
