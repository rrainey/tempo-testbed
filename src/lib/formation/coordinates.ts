// lib/formation/coordinates.ts
import { Vector3, GeodeticCoordinates } from './types';

// Constants
const EARTH_RADIUS_M = 6371000; // Earth radius in meters (approximate)

/**
 * Convert WGS-84 geodetic coordinates to North-East-Down (NED) frame
 * relative to a dropzone center point
 */
export function wgs84ToNEDDZ(
  point: GeodeticCoordinates,
  dzCenter: GeodeticCoordinates
): Vector3 {
  // Convert degrees to radians
  const lat1 = dzCenter.lat_deg * Math.PI / 180;
  const lon1 = dzCenter.lon_deg * Math.PI / 180;
  const lat2 = point.lat_deg * Math.PI / 180;
  const lon2 = point.lon_deg * Math.PI / 180;

  // Calculate differences
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  // Calculate bearing using haversine formula components
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - 
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x); // radians from north

  // Calculate great circle distance
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = EARTH_RADIUS_M * c;

  // Convert to NED coordinates
  const north = distance * Math.cos(bearing);
  const east = distance * Math.sin(bearing);
  const down = dzCenter.alt_m - point.alt_m; // Positive down

  return { x: north, y: east, z: down };
}

/**
 * Transform NED coordinates from DZ frame to Base Exit Frame
 * Base Exit Frame: origin at base jumper position, X-axis along ground track
 */
export function nedDZToBaseExitFrame(
  nedPos: Vector3,
  baseNEDPos: Vector3,
  baseGroundTrack_deg: number
): Vector3 {
  // Translate to base position
  const translated = {
    x: nedPos.x - baseNEDPos.x,
    y: nedPos.y - baseNEDPos.y,
    z: nedPos.z - baseNEDPos.z
  };
  
  // Rotate to align with base jumper's ground track
  const rotation = -baseGroundTrack_deg * Math.PI / 180; // Negative for proper rotation direction
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  
  return {
    x: translated.x * cosR - translated.y * sinR,  // Forward along track
    y: translated.x * sinR + translated.y * cosR,  // Right
    z: translated.z                                 // Down
  };
}

/**
 * Interpolate position between time series samples
 */
export function interpolatePosition(
  timeSeries: TimeSeriesPoint[],
  timeOffset: number
): TimeSeriesPoint & { isInterpolated: boolean } {
  if (timeSeries.length === 0) {
    throw new Error('Cannot interpolate from empty time series');
  }

  // Handle edge cases
  if (timeOffset <= timeSeries[0].timeOffset) {
    return { ...timeSeries[0], isInterpolated: false };
  }
  if (timeOffset >= timeSeries[timeSeries.length - 1].timeOffset) {
    return { ...timeSeries[timeSeries.length - 1], isInterpolated: false };
  }

  // Find surrounding samples
  let before = timeSeries[0];
  let after = timeSeries[1];
  
  for (let i = 0; i < timeSeries.length - 1; i++) {
    if (timeSeries[i].timeOffset <= timeOffset && 
        timeSeries[i + 1].timeOffset > timeOffset) {
      before = timeSeries[i];
      after = timeSeries[i + 1];
      break;
    }
  }

  // Calculate interpolation factor
  const dt = after.timeOffset - before.timeOffset;
  const t = (timeOffset - before.timeOffset) / dt;
  
  // Check if this is a data gap (> 0.5s between samples for 4Hz GPS)
  const isInterpolated = dt > 0.5;
  
  // Linear interpolation for position
  const location = {
    lat_deg: before.location.lat_deg + t * (after.location.lat_deg - before.location.lat_deg),
    lon_deg: before.location.lon_deg + t * (after.location.lon_deg - before.location.lon_deg),
    alt_m: before.location.alt_m + t * (after.location.alt_m - before.location.alt_m)
  };
  
  // Linear interpolation for barometric altitude
  const baroAlt_ft = before.baroAlt_ft + t * (after.baroAlt_ft - before.baroAlt_ft);
  
  // Use latest values for track and speed (more accurate than interpolation)
  const groundtrack_degT = after.groundtrack_degT || before.groundtrack_degT;
  const groundspeed_kmph = after.groundspeed_kmph || before.groundspeed_kmph;
  
  // Calculate vertical speed from barometric altitude change
  const dAlt_m = (after.baroAlt_ft - before.baroAlt_ft) * 0.3048;
  const verticalSpeed_mps = dt > 0 ? -dAlt_m / dt : 0; // Negative because falling
  
  return {
    timeOffset,
    location,
    baroAlt_ft,
    groundtrack_degT,
    groundspeed_kmph,
    verticalSpeed_mps,
    normalizedFallRate_mph: before.normalizedFallRate_mph, // Will be recalculated
    isInterpolated
  };
}

/**
 * Fall rate calibration table from coordinate-frames.md
 */
const FALL_RATE_CALIBRATION = [
  { alt_ft: 20000, factor: 0.8107 },
  { alt_ft: 18000, factor: 0.8385 },
  { alt_ft: 16000, factor: 0.8667 },
  { alt_ft: 14000, factor: 0.8955 },
  { alt_ft: 12000, factor: 0.9247 },
  { alt_ft: 10000, factor: 0.9545 },
  { alt_ft: 9000, factor: 0.9695 },
  { alt_ft: 8000, factor: 0.9847 },
  { alt_ft: 7000, factor: 1.0000 },
  { alt_ft: 6000, factor: 1.0154 },
  { alt_ft: 5000, factor: 1.0310 },
  { alt_ft: 4000, factor: 1.0467 },
  { alt_ft: 3000, factor: 1.0625 },
  { alt_ft: 2000, factor: 1.0784 },
  { alt_ft: 1000, factor: 1.0945 },
  { alt_ft: 0, factor: 1.1107 }
];

/**
 * Linear interpolation helper
 */
function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  return y0 + (x - x0) * (y1 - y0) / (x1 - x0);
}

/**
 * Calibrate fall rate to normalize for air density changes
 * Returns fall rate normalized to 7000ft reference altitude
 */
export function calibrateFallRate(
  verticalSpeed_mps: number,
  altitude_ft: number
): number {
  // Find surrounding calibration points
  let lower = FALL_RATE_CALIBRATION[0];
  let upper = FALL_RATE_CALIBRATION[0];
  
  for (let i = 0; i < FALL_RATE_CALIBRATION.length - 1; i++) {
    if (altitude_ft >= FALL_RATE_CALIBRATION[i + 1].alt_ft &&
        altitude_ft <= FALL_RATE_CALIBRATION[i].alt_ft) {
      upper = FALL_RATE_CALIBRATION[i];
      lower = FALL_RATE_CALIBRATION[i + 1];
      break;
    }
  }
  
  // Handle edge cases
  if (altitude_ft > FALL_RATE_CALIBRATION[0].alt_ft) {
    upper = lower = FALL_RATE_CALIBRATION[0];
  } else if (altitude_ft < FALL_RATE_CALIBRATION[FALL_RATE_CALIBRATION.length - 1].alt_ft) {
    upper = lower = FALL_RATE_CALIBRATION[FALL_RATE_CALIBRATION.length - 1];
  }
  
  // Interpolate calibration factor
  const factor = upper === lower ? upper.factor :
    lerp(altitude_ft, lower.alt_ft, upper.alt_ft, lower.factor, upper.factor);
  
  // Convert to mph and apply calibration
  const uncalibrated_mph = Math.abs(verticalSpeed_mps) * 2.23694;
  return uncalibrated_mph / factor;
}

/**
 * Project all formation participants at a given time
 */
export function projectFormationAtTime(
  participants: ParticipantData[],
  timeOffset: number,
  baseJumperId: string,
  dzCenter: GeodeticCoordinates
): ProjectedPosition[] {
  // Find base jumper
  const baseParticipant = participants.find(p => p.userId === baseJumperId);
  if (!baseParticipant || baseParticipant.timeSeries.length === 0) {
    throw new Error('Base jumper not found or has no data');
  }
  
  // Interpolate base position at current time
  const baseData = interpolatePosition(baseParticipant.timeSeries, timeOffset);
  const baseNEDPos = wgs84ToNEDDZ(baseData.location, dzCenter);
  const baseGroundTrack = baseData.groundtrack_degT || 0;
  
  // Project all participants
  return participants
    .filter(p => p.isVisible && p.timeSeries.length > 0)
    .map(participant => {
      // Interpolate participant position
      const data = interpolatePosition(participant.timeSeries, timeOffset);
      
      // Transform to NED,DZ then to Base Exit Frame
      const nedPos = wgs84ToNEDDZ(data.location, dzCenter);
      const projected = nedDZToBaseExitFrame(nedPos, baseNEDPos, baseGroundTrack);
      
      // Calibrate fall rate

      let normalizedFallRate_mph: number | undefined = undefined;
      if (data.verticalSpeed_mps) {
        normalizedFallRate_mph = calibrateFallRate(
          data.verticalSpeed_mps,
          data.baroAlt_ft
        );
      }
      
      return {
        userId: participant.userId,
        name: participant.name,
        color: participant.color,
        position: projected,
        isDataGap: data.isInterpolated,
        metrics: {
          baroAlt_ft: data.baroAlt_ft,
          verticalSpeed_mps: data.verticalSpeed_mps,
          normalizedFallRate_mph,
          groundtrack_degT: data.groundtrack_degT,
          groundspeed_kmph: data.groundspeed_kmph
        }
      };
    });
}

// Type definitions for the module
export interface TimeSeriesPoint {
  timeOffset: number;
  location: GeodeticCoordinates;
  baroAlt_ft: number;
  groundspeed_kmph?: number;
  groundtrack_degT?: number;
  verticalSpeed_mps?: number;
  normalizedFallRate_mph?: number;
}

export interface ParticipantData {
  userId: string;
  jumpLogId: string;
  name: string;
  color: string;
  isBase: boolean;
  isVisible: boolean;
  timeSeries: TimeSeriesPoint[];
}

export interface ProjectedPosition {
  userId: string;
  name: string;
  color: string;
  position: Vector3;
  isDataGap: boolean;
  metrics: {
    baroAlt_ft: number;
    verticalSpeed_mps?: number;
    normalizedFallRate_mph?: number;
    groundtrack_degT?: number;
    groundspeed_kmph?: number;
  };
}