import { APIRequestContext, expect } from '@playwright/test';

/** Demo accounts created by backend/src/database/seed-users.ts. */
export const CUSTOMER = { email: 'customer@hotel.com', password: 'customer123' };
export const STAFF = { email: 'staff@hotel.com', password: 'staff123' };

export interface Room {
  id: string;
  name: string;
  capacity: number;
  pricePerNight: number;
}

export async function login(
  request: APIRequestContext,
  account: { email: string; password: string },
): Promise<string> {
  const res = await request.post('/api/auth/login', { data: account });
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.accessToken).toBeTruthy();
  return body.accessToken as string;
}

export function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** YYYY-MM-DD, `days` from today (UTC). */
export function dateFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A room that is free for the given stay. Each spec books its own date range,
 * so the specs never collide with each other on the fresh CI database.
 */
export async function findFreeRoom(
  request: APIRequestContext,
  checkIn: string,
  checkOut: string,
): Promise<Room> {
  const res = await request.get('/api/rooms', { params: { checkIn, checkOut, guests: 1 } });
  expect(res.status()).toBe(200);
  const rooms = (await res.json()) as Room[];
  expect(rooms.length, `no free room for ${checkIn}..${checkOut}`).toBeGreaterThan(0);
  return rooms[0];
}
