import { expect, test } from '@playwright/test';

// Lab 05 spec 1 of 3 — "list tasks": the public room catalogue.
test.describe('GET /api/rooms', () => {
  test('lists the seeded rooms without logging in', async ({ request }) => {
    const res = await request.get('/api/rooms');
    expect(res.status()).toBe(200);

    const rooms = await res.json();
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBeGreaterThan(0);
    for (const room of rooms) {
      expect(room).toEqual(
        expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
      );
    }
  });

  test('filters by guest count', async ({ request }) => {
    const res = await request.get('/api/rooms', { params: { guests: 4 } });
    expect(res.status()).toBe(200);
    for (const room of await res.json()) {
      expect(room.capacity).toBeGreaterThanOrEqual(4);
    }
  });
});
