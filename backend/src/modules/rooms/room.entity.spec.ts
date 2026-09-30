import { Room } from './room.entity';

describe('Room.pricePerGuest', () => {
  const load = (pricePerNight: number, capacity: number): Room => {
    const room = Object.assign(new Room(), { pricePerNight, capacity });
    room.computePricePerGuest();
    return room;
  };

  it('splits the nightly price across the room capacity', () => {
    expect(load(3000, 2).pricePerGuest).toBe(1500);
  });

  it('rounds to 2 decimals', () => {
    expect(load(2500, 3).pricePerGuest).toBe(833.33);
  });

  it('is left out when the capacity is not positive', () => {
    expect(load(2500, 0).pricePerGuest).toBeUndefined();
  });
});
