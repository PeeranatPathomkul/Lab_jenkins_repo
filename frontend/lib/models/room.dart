enum RoomType { standard, deluxe, suite, family }

extension RoomTypeX on RoomType {
  String get label {
    switch (this) {
      case RoomType.standard:
        return 'Standard';
      case RoomType.deluxe:
        return 'Deluxe';
      case RoomType.suite:
        return 'Suite';
      case RoomType.family:
        return 'Family';
    }
  }
}

/// Operational status of a room set by staff. Only [available] rooms can be
/// booked by customers; [maintenance] rooms are hidden from search.
enum RoomStatus { available, maintenance }

extension RoomStatusX on RoomStatus {
  String get label =>
      this == RoomStatus.available ? 'Available' : 'Under maintenance';
}

class Room {
  final String id;
  String name;
  RoomType type;
  double pricePerNight;
  int capacity;
  String description;
  List<String> imageUrls;
  List<String> amenities;
  RoomStatus status;

  /// Nightly price per guest at full occupancy, as computed by the API
  /// (`pricePerGuest`). Null for rooms that did not come from the API.
  double? pricePerGuest;

  Room({
    required this.id,
    required this.name,
    required this.type,
    required this.pricePerNight,
    required this.capacity,
    required this.description,
    required this.imageUrls,
    required this.amenities,
    this.status = RoomStatus.available,
    this.pricePerGuest,
  });

  String get primaryImage =>
      imageUrls.isNotEmpty ? imageUrls.first : '';
}

/// An anonymised booked date-range (no customer data) from
/// `GET /api/rooms/availability`. Used to compute true availability across ALL
/// customers on the client.
class BookedRange {
  final String roomId;
  final DateTime checkIn;
  final DateTime checkOut;

  const BookedRange({
    required this.roomId,
    required this.checkIn,
    required this.checkOut,
  });

  factory BookedRange.fromJson(Map<String, dynamic> json) => BookedRange(
        roomId: json['roomId'] as String,
        checkIn: DateTime.parse(json['checkIn'] as String),
        checkOut: DateTime.parse(json['checkOut'] as String),
      );

  /// True if [day] falls within this range (half-open [checkIn, checkOut)).
  bool covers(DateTime day) =>
      !day.isBefore(checkIn) && day.isBefore(checkOut);

  /// True if this range overlaps [ci, co) (half-open).
  bool overlaps(DateTime ci, DateTime co) =>
      ci.isBefore(checkOut) && checkIn.isBefore(co);
}
