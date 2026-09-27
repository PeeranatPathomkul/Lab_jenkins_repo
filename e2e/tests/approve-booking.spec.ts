import { expect, test } from '@playwright/test';
import { CUSTOMER, STAFF, bearer, dateFromToday, findFreeRoom, login } from './helpers';

// Lab 05 spec 3 of 3 — "mark task done": front-desk staff approves a booking.
test.describe('PATCH /api/staff/bookings/:id', () => {
  test('staff approves a pending booking and the customer sees it approved', async ({ request }) => {
    const customerToken = await login(request, CUSTOMER);
    const checkIn = dateFromToday(50);
    const checkOut = dateFromToday(51);
    const room = await findFreeRoom(request, checkIn, checkOut);

    const created = await request.post('/api/bookings', {
      headers: bearer(customerToken),
      data: { roomId: room.id, checkIn, checkOut, guests: 1 },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = await created.json();

    const staffToken = await login(request, STAFF);
    const approved = await request.patch(`/api/staff/bookings/${id}`, {
      headers: bearer(staffToken),
      data: { status: 'approved' },
    });
    expect(approved.status(), await approved.text()).toBe(200);
    expect((await approved.json()).status).toBe('approved');

    const mine = await request.get('/api/bookings/me', { headers: bearer(customerToken) });
    const booking = (await mine.json()).find((b: { id: string }) => b.id === id);
    expect(booking.status).toBe('approved');
  });

  test('a customer cannot use the staff endpoint', async ({ request }) => {
    const customerToken = await login(request, CUSTOMER);
    const res = await request.patch('/api/staff/bookings/00000000-0000-0000-0000-000000000000', {
      headers: bearer(customerToken),
      data: { status: 'approved' },
    });
    expect(res.status()).toBe(403);
  });
});
