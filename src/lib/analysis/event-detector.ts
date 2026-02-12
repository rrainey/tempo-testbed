// lib/analysis/event-detector.ts

import { ParsedLogData, TimeSeriesPoint } from './log-parser';
import { KMLDataV1, Vector3 } from './dropkick-reader';
import { METERStoFEET } from './dropkick-tools';

export interface JumpEvents {
  exitOffsetSec?: number;
  deploymentOffsetSec?: number;
  landingOffsetSec?: number;
  
  // Additional event metadata
  exitAltitudeFt?: number;
  deployAltitudeFt?: number;
  maxDescentRateFpm?: number;
  
  // New fields from DropkickReader data
  peakAcceleration?: number; // m/s²
  exitLatitude?: number;
  exitLongitude?: number;
}

export class EventDetector {
  /**
   * Detect exit from aircraft.
   *
   * Primary method: use $PST state transition LOGGING → JUMPED.
   * The device triggers this after 0.5s of sustained < 0.6g, so we
   * subtract 0.5s to estimate the actual exit moment.
   *
   * Fallback: first sample with GNSS-derived RoD > 5000 fpm AND accel < 0.8g.
   */
  static detectExit(data: ParsedLogData): { offsetSec?: number; altitudeFt?: number; latitude?: number; longitude?: number } {
    const { logEntries } = data;

    // --- Primary: $PST JUMPED transition ---
    const jumpedTransition = data.stateTransitions?.find(
      t => t.toState === 'JUMPED'
    );

    if (jumpedTransition) {
      const exitTime = jumpedTransition.timeOffset_sec - 0.5; // device confirmed after 0.5s of low-g

      // Find the closest log entry to get altitude and position
      const exitEntry = this.findClosestEntry(logEntries, exitTime);

      console.log(`[EVENT DETECTOR] Exit detected via $PST JUMPED at ${exitTime.toFixed(1)}s, altitude ${exitEntry?.baroAlt_ft || 'unknown'}ft`);

      return {
        offsetSec: exitTime,
        altitudeFt: exitEntry?.baroAlt_ft || undefined,
        latitude: exitEntry?.location?.lat_deg,
        longitude: exitEntry?.location?.lon_deg,
      };
    }

    // --- Fallback: accel + RoD heuristic ---
    for (let i = 0; i < logEntries.length - 4; i++) {
      const entry = logEntries[i];

      if (!entry.accel_mps2 || entry.rateOfDescent_fpm === null || entry.rateOfDescent_fpm < 5000) {
        continue;
      }

      const accelMag = Math.sqrt(entry.accel_mps2.x * entry.accel_mps2.x +
                            entry.accel_mps2.y * entry.accel_mps2.y +
                            entry.accel_mps2.z * entry.accel_mps2.z);

      if (accelMag < 9.81 * 0.8) {
        console.log(`[EVENT DETECTOR] Exit detected via accel/RoD fallback at ${entry.timeOffset.toFixed(1)}s, altitude ${entry.baroAlt_ft || 'unknown'}ft`);

        return {
          offsetSec: entry.timeOffset,
          altitudeFt: entry.baroAlt_ft || undefined,
          latitude: entry.location?.lat_deg,
          longitude: entry.location?.lon_deg
        };
      }
    }

    console.log('[EVENT DETECTOR] No exit detected');
    return {};
  }

  /**
   * Find the log entry closest to a given time offset
   */
  private static findClosestEntry(logEntries: KMLDataV1[], timeOffset: number): KMLDataV1 | null {
    if (logEntries.length === 0) return null;

    let closest = logEntries[0];
    let minDist = Math.abs(closest.timeOffset - timeOffset);

    for (const entry of logEntries) {
      const dist = Math.abs(entry.timeOffset - timeOffset);
      if (dist < minDist) {
        minDist = dist;
        closest = entry;
      }
      // entries are time-sorted, so once we start getting farther away we can stop
      if (entry.timeOffset > timeOffset + 1) break;
    }

    return closest;
  }
  
  /**
   * Detect deployment using acceleration data from IMU
   * Deployment is 0.25g deceleration for 0.1s
   */
  static detectDeployment(data: ParsedLogData): { 
    deploymentOffsetSec?: number; 
    activationOffsetSec?: number;
    deployAltitudeFt?: number;
  } {
    const { logEntries } = data;
    
    const gThreshold = 1.5 * 9.81;
    
    let deploymentTime: number | undefined;
    let deploymentAlt: number | undefined;
    let peakAccel = 0;
    
    // Look for rapid deceleration using IMU data
    for (let i = 1; i < logEntries.length; i++) {
      const entry = logEntries[i];
      
      // Skip if no acceleration data or not in freefall
      if (!entry.accel_mps2 || entry.rateOfDescent_fpm === null || entry.rateOfDescent_fpm < 5000) {
        continue;
      }

      const accelMag = Math.sqrt(entry.accel_mps2.x * entry.accel_mps2.x +
                            entry.accel_mps2.y * entry.accel_mps2.y +
                            entry.accel_mps2.z * entry.accel_mps2.z);

      // Look for significant acceleration

      const threshold_mps2 = 9.81 + gThreshold;

      if (accelMag > threshold_mps2) {

          deploymentTime = entry.timeOffset;
          deploymentAlt = entry.baroAlt_ft || undefined;
          peakAccel = accelMag;
          
          console.log(`[EVENT DETECTOR] Deployment detected at ${deploymentTime.toFixed(1)}s, altitude ${deploymentAlt || 'unknown'}ft, peak ${accelMag.toFixed(2)} m/s²`);
          break;
      }
    }
    
    // Look for activation (first RoD < 2000 fpm after deployment)
    let activationTime: number | undefined;
    
    if (deploymentTime !== undefined) {
      const deployIdx = logEntries.findIndex(e => e.timeOffset >= deploymentTime);
      
      for (let i = deployIdx; i < logEntries.length; i++) {
        const entry = logEntries[i];
        if (entry.rateOfDescent_fpm !== null && entry.rateOfDescent_fpm < 2000) {
          activationTime = entry.timeOffset;
          console.log(`[EVENT DETECTOR] Activation detected at ${activationTime.toFixed(1)}s`);
          break;
        }
      }
    }
    
    return {
      deploymentOffsetSec: deploymentTime,
      activationOffsetSec: activationTime,
      deployAltitudeFt: deploymentAlt
    };
  }
  
  /**
   * Detect landing
   * Landing is RoD <100 fpm for 10s
   */
  static detectLanding(data: ParsedLogData, deploymentOffset_sec: number  ): { offsetSec?: number } {
    const { logEntries } = data;

    if (data.dzSurfacePressureAltitude_m === undefined) {
        console.log('[EVENT DETECTOR] No DZ surface altitude available, cannot detect landing');
        return {};
    }

    // baroAlt_ft is already AGL (surface pressure altitude subtracted in DropkickReader),
    // so we compare against 0, not against the DZ surface elevation.

    // Find first sustained low descent rate
    for (let i = 0; i < logEntries.length; i++) {
      const entry = logEntries[i];

      if (entry.timeOffset < deploymentOffset_sec) continue;

      // Skip if no altitude data
      if (entry.baroAlt_ft === null ) continue;

      // Must be near ground level (within 100 ft AGL) to be a landing candidate
      if (Math.abs(entry.baroAlt_ft) > 100) continue; 
      
      // Look ahead to see if it stays low for 10 seconds
      let duration = 0;
      
      for (let j = i + 1; j < logEntries.length; j++) {
        const nextEntry = logEntries[j];
        duration = nextEntry.timeOffset - entry.timeOffset;

        if (nextEntry.baroAlt_ft === null) continue;

        const diff = Math.abs(nextEntry.baroAlt_ft - entry.baroAlt_ft);

        //console.log(`[EVENT DETECTOR] Landing check at ${entry.timeOffset.toFixed(1)}s, altitude ${entry.baroAlt_ft}ft, diff ${diff.toFixed(1)}ft, duration ${duration.toFixed(1)}s`);  

        if (diff > 20.0) {
            break; // too much altitude change — this candidate is not landing
        }
        
        if (duration >= 20) {
          console.log(`[EVENT DETECTOR] Landing detected at ${entry.timeOffset.toFixed(1)}s`);
          return { offsetSec: entry.timeOffset };
        }
        
      }

    }
  
    console.log('[EVENT DETECTOR] No landing detected');
    return {};
  }
  
  /**
   * Calculate magnitude of a 3D vector
   */
  private static vectorMagnitude(v: Vector3): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }
  
  /**
   * Analyze all events in a jump
   */
  static analyzeJump(data: ParsedLogData): JumpEvents {
    const events: JumpEvents = {};
    
    // Detect exit
    const exit = this.detectExit(data);
    if (exit.offsetSec !== undefined) {
      events.exitOffsetSec = exit.offsetSec;
      events.exitAltitudeFt = exit.altitudeFt;
      events.exitLatitude = exit.latitude;
      events.exitLongitude = exit.longitude;
    }
    
    // Detect deployment
    const deployment = this.detectDeployment(data);
    if (deployment.deploymentOffsetSec !== undefined) {
      events.deploymentOffsetSec = deployment.deploymentOffsetSec;
      events.deployAltitudeFt = deployment.deployAltitudeFt;
    }
    
    // Detect landing
    const landing = this.detectLanding(data, events.deploymentOffsetSec || 30.0);
    if (landing.offsetSec !== undefined) {
      events.landingOffsetSec = landing.offsetSec;
    }
    
    // Find max descent rate and peak acceleration during freefall
    if (events.exitOffsetSec !== undefined && events.deploymentOffsetSec !== undefined) {
      let maxDescentRate = 0;
      let peakAccel = 0;
      
      for (const entry of data.logEntries) {
        if (entry.timeOffset >= events.exitOffsetSec && 
            entry.timeOffset <= events.deploymentOffsetSec) {
          
          // Track max descent rate
          if (entry.rateOfDescent_fpm !== null) {
            maxDescentRate = Math.max(maxDescentRate, entry.rateOfDescent_fpm);
          }
          
          // Track peak acceleration
          if (entry.peakAccel_mps2) {
            const mag = this.vectorMagnitude(entry.peakAccel_mps2);
            peakAccel = Math.max(peakAccel, mag);
          }
        }
      }
      
      events.maxDescentRateFpm = maxDescentRate;
      events.peakAcceleration = peakAccel;
    }
    
    return events;
  }
}