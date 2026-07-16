// tools/jump-review/geo.js
//
// Plain-JS geometry for the analyst stage (the web side uses the TypeScript
// twins in @tempo/core/analysis/gps-path-utils; keep behavior identical).

function pointInRing(lon, lat, ring) {
  let inside = false;
  let j = ring.length - 1;
  for (let i = 0; i < ring.length; i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function findContainingPolygon(collection, lon, lat) {
  for (const f of collection.features ?? []) {
    if (f.geometry?.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0];
    if (ring && pointInRing(lon, lat, ring)) return f;
  }
  return null;
}

module.exports = { pointInRing, haversineMeters, findContainingPolygon };
