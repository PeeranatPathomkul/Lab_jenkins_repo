import { expect, test } from '@playwright/test';
import { CUSTOMER, bearer, dateFromToday, findFreeRoom, login } from './helpers';

// Lab 05 spec 2 of 3 — "create task": a customer books a room.
test.describe('POST /api/bookings', () => {
  test('a logged-in customer can book a free room', async ({ request }) => {
    const token = await login(request, CUSTOMER);
    const checkIn = dateFromToday(30);
    const checkOut = dateFromToday(32);
    const room = await findFreeRoom(request, checkIn, checkOut);

    const res = await request.post('/api/bookings', {
      headers: bearer(token),
      data: { roomId: room.id, checkIn, checkOut, guests: 1 },
    });
    expect(res.status(), await res.text()).toBe(201);

    const booking = await res.json();
    expect(booking).toMatchObject({
      roomId: room.id,
      checkIn,
      checkOut,
      nights: 2,
      status: 'pending',
      paymentStatus: 'unpaid',
    });

    const mine = await request.get('/api/bookings/me', { headers: bearer(token) });
    expect(mine.status()).toBe(200);
    expect((await mine.json()).map((b: { id: string }) => b.id)).toContain(booking.id);
  });

  test('booking without logging in is rejected', async ({ request }) => {
    const res = await request.post('/api/bookings', {
      data: { roomId: '00000000-0000-0000-0000-000000000000', checkIn: dateFromToday(40), checkOut: dateFromToday(41), guests: 1 },
    });
    expect(res.status()).toBe(401);
  });
});
