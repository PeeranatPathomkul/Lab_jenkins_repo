import '../../models/room.dart';
import '../room_repository.dart';
import 'api_client.dart';

/// HTTP [RoomRepository] against `/api/rooms` and `/api/staff/rooms`.
class ApiRoomRepository implements RoomRepository {
  ApiRoomRepository(this._api);

  final ApiClient _api;

  /// Customers get the public catalogue, which hides rooms under maintenance;
  /// staff get every room, because the back-office manages exactly those.
  @override
  Future<List<Room>> fetchRooms() async {
    final path = _api.isStaffSide ? '/api/staff/rooms' : '/api/rooms';
    final data = await _api.get(path, auth: _api.isStaffSide) as List<dynamic>;
    return data
        .map((e) => roomFromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  @override
  Future<List<BookedRange>> fetchBookedRanges({DateTime? from, DateTime? to}) async {
    final query = <String, String>{};
    if (from != null) query['from'] = ymd(from);
    if (to != null) query['to'] = ymd(to);
    final data = await _api.get(
      '/api/rooms/availability',
      query: query.isEmpty ? null : query,
      auth: false,
    ) as List<dynamic>;
    return data
        .map((e) => BookedRange.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  /// Availability search. Not part of [RoomRepository] yet — the date-range
  /// screens still filter client-side — but the endpoint is the one the
  /// exclusion constraint agrees with, so move them onto this next.
  Future<List<Room>> searchAvailable({
    required DateTime checkIn,
    required DateTime checkOut,
    int? guests,
  }) async {
    final query = {'checkIn': ymd(checkIn), 'checkOut': ymd(checkOut)};
    if (guests != null) query['guests'] = guests.toString();

    final data = await _api.get('/api/rooms', query: query, auth: false) as List<dynamic>;
    return data
        .map((e) => roomFromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  @override
  Future<Room> createRoom({
    required String name,
    required RoomType type,
    required double pricePerNight,
    required int capacity,
    required String description,
    required List<String> imageUrls,
    required List<String> amenities,
  }) async {
    final data = await _api.post('/api/staff/rooms', body: {
      'name': name,
      'type': type.name,
      'pricePerNight': pricePerNight,
      'capacity': capacity,
      'description': description,
      'imageUrls': imageUrls,
      'amenities': amenities,
    });
    return roomFromJson(data as Map<String, dynamic>);
  }

  @override
  Future<Room> updateRoom(Room room) async {
    final data = await _api.patch('/api/staff/rooms/${room.id}', body: {
      'name': room.name,
      'type': room.type.name,
      'pricePerNight': room.pricePerNight,
      'capacity': room.capacity,
      'description': room.description,
      'imageUrls': room.imageUrls,
      'amenities': room.amenities,
      'status': room.status.name,
    });
    return roomFromJson(data as Map<String, dynamic>);
  }

  @override
  Future<Room> updatePrice(String id, double pricePerNight) async {
    final data = await _api.patch(
      '/api/staff/rooms/$id',
      body: {'pricePerNight': pricePerNight},
    );
    return roomFromJson(data as Map<String, dynamic>);
  }

  @override
  Future<Room> updateStatus(String id, RoomStatus status) async {
    final data = await _api.patch(
      '/api/staff/rooms/$id',
      body: {'status': status.name},
    );
    return roomFromJson(data as Map<String, dynamic>);
  }

  @override
  Future<void> deleteRoom(String id) => _api.delete('/api/staff/rooms/$id');
}

Room roomFromJson(Map<String, dynamic> json) {
  return Room(
    id: json['id'] as String,
    name: json['name'] as String,
    type: RoomType.values.firstWhere(
      (t) => t.name == json['type'],
      orElse: () => RoomType.standard,
    ),
    // numeric(10,2) is serialised as a JSON number by the API transformer, but
    // `num` covers the case where it arrives as an int (e.g. 2500 not 2500.0).
    pricePerNight: (json['pricePerNight'] as num).toDouble(),
    capacity: (json['capacity'] as num).toInt(),
    pricePerGuest: (json['pricePerGuest'] as num?)?.toDouble(),
    description: (json['description'] as String?) ?? '',
    imageUrls: ((json['imageUrls'] as List<dynamic>?) ?? const [])
        .map((e) => e as String)
        .toList(),
    amenities: ((json['amenities'] as List<dynamic>?) ?? const [])
        .map((e) => e as String)
        .toList(),
    status: RoomStatus.values.firstWhere(
      (s) => s.name == json['status'],
      orElse: () => RoomStatus.available,
    ),
  );
}
