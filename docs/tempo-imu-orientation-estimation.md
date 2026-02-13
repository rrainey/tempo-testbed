# Tempo-BT: Estimating Skydiver Body Orientation from IMU Data

*Background document for the Tempo project, February 2026*

---

## The Core Problem

The ICM-42688-V IMU on the Tempo-BT device continuously updates an orientation quaternion, output in the `$PIM2` sentences in the device log. This quaternion gives us the device's orientation relative to some reference frame (call it **R** — likely a gravity-aligned frame established at boot, with arbitrary heading). We need a fixed rotation that maps from device frame to a defined skydiver body frame. Once we have that, we can chain the transformations to display body orientation in NED.

---

## Frame Definitions

### Skydiver Body Frame (B)

Defined analogously to the AIAA aircraft body frame:

- **+X_b**: out of chest ("forward" when standing, "down" in stable belly-to-earth freefall)
- **+Y_b**: right
- **+Z_b**: down (when standing)
- Right-handed: **Y_b = Z_b × X_b**

### Device Frame (D)

The IMU's sensor frame, fixed relative to the PCB. Orientation relative to the jumper's body depends on how the device sits in the chest pocket — unknown but approximately constant for a given jump.

### Reference Frame (R)

The frame the AHRS filter quaternion is referenced to. When using a Madgwick/Mahony complementary filter with the ICM-42688, this is typically gravity-aligned with an arbitrary (gyro-integrated) heading at boot. Pitch and roll are corrected to gravity; heading drifts without a magnetometer.

### NED (North-East-Down)

The standard earth-fixed navigation frame.

### The Key Unknown

**R_D→B** — the fixed rotation from device frame to body frame. The device sits in the chest pocket at some unknown but approximately constant orientation relative to the jumper's torso.

---

## What Each Flight Phase Gives Us

### Stable Belly-to-Earth Freefall → Body +X_b Direction

During stable freefall, the jumper is arched, chest facing earth. Body +X_b points approximately straight down, which is NED +D = [0, 0, 1]\_NED.

The quaternion q(t) from the AHRS gives us R\_R→D(t). If R is gravity-aligned, then "down" in R is [0, 0, 1]\_R (assuming R uses a down-positive Z convention; adjust sign if it uses up-positive). We can rotate this into device frame:

> **d\_D(t) = q(t) ⊗ [0, 0, 1]\_R ⊗ q(t)\***

This vector d\_D(t), expressed in device coordinates, should correspond to body +X\_b during stable freefall. Average it over the stable phase to get a clean estimate:

> **x̂\_b^D = normalize( mean( d\_D(t) ) )** over the stable freefall window

**Important caveat**: during true freefall the accelerometer reads near-zero (the device is in free fall, so it can't sense gravity directly). The AHRS filter loses its gravity correction and relies on pure gyro integration, so the quaternion will drift. This means the freefall-derived +X estimate is noisier the longer freefall continues. Best practice: use the first 5–10 seconds of stable freefall, while the quaternion is still well-anchored from the pre-exit gravity reference, and before accumulated gyro drift becomes significant.

### Prior Landing Phase (150–50 ft AGL) → Body +Z_b Direction

Under canopy, the jumper hangs approximately upright. Body +Z\_b (down when standing) aligns closely with gravity. And critically, the parachute descent is quasi-steady — low acceleration, no turbulence compared to freefall — so the accelerometer reads clean gravity.

The accelerometer measures specific force (proper acceleration), which in steady or quasi-steady flight equals −g in the gravity direction. If gravity points along body +Z\_b, then the accelerometer in body frame reads approximately [0, 0, −g]\_B. In device frame, the accelerometer output is:

> **a\_D(t) ≈ −g · ẑ\_b^D**

where ẑ\_b^D is the body +Z axis expressed in device coordinates. Therefore:

> **ẑ\_b^D = normalize( −mean( a\_D(t) ) )** over the prior-landing window

This is the more reliable of the two estimates because it comes directly from a physical measurement (accelerometer) during a phase where the sensor has full gravity observability. No quaternion drift involved.

### Optional: GPS Track Heading During Canopy → Body +X_b Heading Component

Under canopy, the jumper faces approximately into the direction of travel (the parachute pulls them forward). Body +X\_b projected onto the horizontal plane should align with the GPS ground track heading. If `$GNVTG` gives course-over-ground θ during the canopy phase, then in NED:

> **x̂\_b^NED\_horizontal ≈ [cos(θ), sin(θ), 0]\_NED**

This isn't strictly necessary for the initial estimate (we can get +X from freefall), but it provides an independent cross-check and could be used to resolve heading ambiguity if the AHRS reference frame heading is unknown.

---

## Constructing the Rotation Matrix

We now have two vectors in device frame — x̂\_b^D (from freefall) and ẑ\_b^D (from canopy) — that should ideally be orthogonal but won't be exactly, due to measurement noise and the fact that the jumper isn't perfectly belly-to-earth or perfectly upright.

### Orthogonalization

Prioritize ẑ\_b^D (the more reliable measurement):

1. **Keep ẑ\_b^D as-is** (directly from accelerometer, high confidence).
2. **Remove the ẑ\_b^D component from x̂\_b^D** to enforce orthogonality:
   - x̂'\_b^D = x̂\_b^D − (x̂\_b^D · ẑ\_b^D) ẑ\_b^D
   - x̂\_b^D = normalize(x̂'\_b^D)
3. **Complete the right-handed system** via cross product:
   - ŷ\_b^D = ẑ\_b^D × x̂\_b^D

### Rotation Matrices

Three orthonormal vectors {x̂\_b^D, ŷ\_b^D, ẑ\_b^D} — the body frame axes expressed in device frame coordinates — form the rotation matrix from body to device:

> **R\_B→D = [ x̂\_b^D | ŷ\_b^D | ẑ\_b^D ]** (columns are the body axes in device coords)

And the inverse (device to body):

> **R\_D→B = R\_B→D^T** (rows are the body axes in device coords)

This can be converted to a quaternion **q\_D→B** using standard DCM-to-quaternion conversion.

---

## The Full Transformation Chain

To display body orientation in NED at any time t:

1. The AHRS gives **q\_R→D(t)** from `$PIM2`.
2. We estimated **q\_D→B** (fixed for the jump).
3. We need **q\_R→NED** (a fixed heading rotation if R is gravity-aligned but heading-unknown).

> **q\_R→B(t) = q\_D→B ⊗ q\_R→D(t)**

This gives body orientation relative to the AHRS reference frame. If R is already NED-aligned (or close enough), this is directly usable. If R has an unknown heading offset, it can be solved using the GPS track heading during canopy flight:

- Under canopy, body +X\_b projected horizontal should match GPS course θ.
- The heading correction q\_R→NED is a rotation about the vertical axis (down) by the difference between the observed body +X heading in R-frame and the GPS heading.
- This is a single scalar unknown (yaw offset) that can be averaged over the canopy phase.

Final result:

> **q\_NED→B(t) = q\_D→B ⊗ q\_R→D(t) ⊗ q\_NED→R**

Or equivalently, **q\_B→NED(t)** for converting body vectors to NED for display.

---

## Practical Considerations for Implementation

### Selecting the Stable Freefall Window

Use `$PST` state = JUMPED, then look for a segment where the quaternion rate-of-change is low (the jumper is in a stable arch, not spinning or transitioning). Exclude the first few seconds after exit (tumbling/instability) and the last ~15 seconds before deployment (tracking). A reasonable default: exit+10s through deployment−20s.

### Selecting the Prior-Landing Window

Defined as 150–50 ft AGL. The jumper is on final approach, forward velocity, low sink rate, no aggressive turns. Compute AGL from the barometric altitude minus the surface elevation (from GPS or DZ metadata). Verify steady-state by checking that the accelerometer magnitude is close to 1g (no aggressive maneuvers).

### Degenerate Cases

If the jump has very short freefall (hop-n-pop), the algorithm needs fallback logic. One fallback might be to use the direction of the track-made-good while on final approach to landing. A track-made-good vector perpendicular to the gravity-derived +Z-vector is usable as the +X-vector. For the testbed, flagging this as "insufficient data for orientation estimate" is appropriate initially.

### Sensitivity / Quality Check

The angle between the raw (pre-orthogonalization) x̂\_b^D and ẑ\_b^D should be somewhere around 90°. If it's significantly different (say, less than 60° or greater than 120°), something is wrong — either the flight phases were misidentified, or the device moved in the pocket during the jump. Reporting this angle as a quality metric gives the user confidence in the estimate.

### Manual Adjustment ("Grab and Reorient")

Store q\_D→B as an editable parameter in the baseline/metadata. The automated estimate seeds it; the reviewer can apply a manual correction quaternion on top. The viewer reads the current q\_D→B and applies it uniformly. This is a future capability to be layered on after the automated estimate is working.

---

## Summary

| Flight Phase | Observable | Body Axis Recovered | Measurement Source | Reliability |
|---|---|---|---|---|
| Stable freefall | Gravity direction via quaternion | +X\_b (chest = down) | AHRS quaternion (gyro-dominated) | Moderate (gyro drift limits window) |
| Prior landing (150–50 ft AGL) | Gravity direction via accelerometer | +Z\_b (down when upright) | Raw accelerometer | High (direct measurement, quasi-steady) |
| Canopy flight (GPS track) | Heading via course-over-ground | +X\_b horizontal component | GPS `$GNVTG` | Moderate (heading only, no pitch) |

The approach uses two independent flight regimes to recover two of the three body axes, which is exactly what's needed to fully constrain the rotation (the third axis follows by cross product). The math is standard rotation algebra and chains cleanly through the quaternion pipeline the firmware already produces.