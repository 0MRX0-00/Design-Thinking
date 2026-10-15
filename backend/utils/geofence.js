// CampusShield Geofence & Campus Boundary Verification Utility
// Institution: Kongu Engineering College (KEC), Perundurai, Erode

export const KEC_GEOFENCE = {
  name: 'Kongu Engineering College',
  centerLat: 11.2742,
  centerLng: 77.6070,
  radiusMeters: 1800, // 1.8km radius encompasses the entire 167-acre campus, hostels, playgrounds, and gates
  defaultCampusAddress: 'Kongu Engineering College, Perundurai, Erode, Tamil Nadu 638052'
};

/**
 * Calculates great-circle distance between two coordinates in meters using the Haversine formula
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) {
    return Infinity;
  }
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Validates if coordinates fall within the authorized campus boundary
 */
export function checkCampusGeofence(lat, lng, maxRadius = KEC_GEOFENCE.radiusMeters) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return {
      inside: true, // If no coordinates provided, let campusLocation fallback decide
      distanceMeters: 0,
      allowedRadius: maxRadius
    };
  }

  const distanceMeters = calculateDistanceMeters(
    parseFloat(lat),
    parseFloat(lng),
    KEC_GEOFENCE.centerLat,
    KEC_GEOFENCE.centerLng
  );

  return {
    inside: distanceMeters <= maxRadius,
    distanceMeters,
    allowedRadius: maxRadius,
    campus: KEC_GEOFENCE.name
  };
}
