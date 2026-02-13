# BMP390 Pressure Sensor as Precision Altimeter: Cross-Device Alignment Research

*Research compiled for the Tempo-BT project, February 2026*

In our current analysis of groups skydives we see differences in the reported barometric altimeter readings in each device. I asked Opus 4.6 to research how we might more closely correlate readings among the devices.

---

## What Bosch Tells You (and What They Don't)

The BMP390 datasheet specifies two very different accuracy numbers, and the gap between them is the core of the cross-device alignment problem:

**Relative accuracy: ±3 Pa (±0.25 m).** This is the sensor's ability to detect *changes* in pressure at a single sensor, measured in 10 kPa steps over 700–1100 hPa at 25–40°C. This is excellent — it means a single Tempo device can track its own altitude changes to about 25 cm precision.

**Absolute accuracy: ±50 Pa (±4 m).** This is how close the sensor's raw pressure reading is to the *true* atmospheric pressure, across the full operating range. Each BMP390 comes out of the factory with its own unique offset from truth. Two devices sitting on the same table can disagree by up to 100 Pa (the sum of their individual errors), which translates to roughly 8 meters of apparent altitude difference.

Bosch also specifies a **temperature coefficient offset (TCO) of ±0.6 Pa/K** (mean, at 25–40°C and 900 hPa). As temperature changes during the jump — from a warm aircraft cabin through cold freefall air — each sensor's offset drifts slightly differently. Over a 20°C swing, that's potentially another ±12 Pa (~1 m) of divergence between devices.

The datasheet also notes **long-term stability drift of ±0.16 hPa over 12 months** and **solder drift of up to ±0.8 hPa** from PCB assembly. These are baked-in offsets that persist until recalibration.

Bosch provides factory-programmed **trimming coefficients** (11 pressure parameters, 3 temperature parameters stored in NVM at registers 0x31–0x45) that compensate for manufacturing variations in each individual die. The compensation formulae in the datasheet appendix use these to convert raw ADC counts to calibrated pressure and temperature. This compensation is already applied by the BMP3xx driver — so the ±50 Pa absolute accuracy figure is *after* factory compensation. There's no additional user-accessible calibration mechanism in the chip itself.

The datasheet's **recommended settings table** (Table 10) suggests different oversampling and IIR filter configurations for various use cases but doesn't include anything resembling "skydiving" or "multi-device formation." The closest relevant configurations are:

| Use Case | Oversampling | IIR Coeff | ODR | RMS Noise |
|---|---|---|---|---|
| Drone | Standard ×8 | 2 | 50 Hz | 11 cm |
| Indoor Navigation | Ultra High ×16 | 4 | 25 Hz | 5 cm |

The Tempo firmware needs to balance sample rate against noise floor for the freefall environment, which is more dynamic than any of Bosch's listed use cases.

Notably, **Bosch does not publish an application note on multi-sensor altitude alignment.** On their community forum, when asked directly about using two BMP390 sensors to measure relative altitude, a Bosch engineer's advice was simply: place both sensors under the same pressure, read them, compare to a reference barometer, compute an offset for each, and subtract it going forward. They acknowledged they hadn't tested the scenario and couldn't guarantee the resulting accuracy. They also noted that because of the ±0.16 hPa/year drift, periodic recalibration would be necessary.

---

## The Fundamental Physics Problem

Converting pressure to altitude requires the barometric formula (or its more general form, the hypsometric equation). The standard ISA simplification used in most embedded code is:

> **h = 44330 × [1 − (P/P₀)^0.190294]** meters

where P₀ is the reference sea-level pressure (typically 1013.25 hPa). This assumes a standard temperature lapse rate of 6.5°C/km and a sea-level temperature of 15°C.

The more accurate hypsometric form uses measured temperature:

> **Δh = (R × T̄) / g × ln(P₁/P₂)**

where T̄ is the mean virtual temperature of the layer, R is the gas constant for dry air (~287 J/kg·K), and g is gravitational acceleration.

For the Tempo use case, the critical insight is that **all of these formulae convert a pressure ratio to a height difference.** Any fixed offset in absolute pressure between two sensors produces a fixed offset in computed altitude. Near sea level, 1 hPa ≈ 8.3 m of altitude. At jump altitude (~14,000 ft / 580 hPa), the atmosphere is less dense and 1 hPa ≈ 12–13 m. So the ±50 Pa absolute accuracy spec translates to roughly ±4 m at ground level but ±6–7 m at exit altitude.

Temperature matters for a different reason. The ISA formula assumes a standard lapse rate. On the day of these jumps in Texas, the actual temperature profile almost certainly didn't match ISA. But — and this is key — **all three devices are falling through the same air column**, so the temperature error affects all their altitude calculations identically. It introduces an error in *absolute* altitude (how high they actually are above sea level) but not in *relative* altitude between jumpers. The temperature coefficient offset in the sensor itself (the TCO spec) is a separate concern — it's about the sensor electronics responding to temperature, not the atmosphere.

---

## Practical Approaches to Cross-Device Alignment

Drawing from the broader literature — drone swarms, indoor positioning research, the AMSYS application note on the MS5611, the Zaliva/Franchetti GPS-barometric fusion paper, and the PMC research on sensor arrays — the following methods apply to the Tempo situation, roughly ordered from simplest to most involved.

### 1. Ground-Level Offset Calibration (Static Bias Removal)

The simplest and most effective technique. Before boarding the aircraft, all devices are at the same elevation. Record each device's pressure reading at a known common moment (or average over a window). Compute the difference between each device and a chosen reference (or the group mean). Subtract that offset from all subsequent readings.

This eliminates the bulk of the ±50 Pa absolute accuracy spread. After this step, the devices should agree to within their *relative* accuracy spec (±3 Pa / ±0.25 m) plus any TCO-driven drift during the jump.

For Tempo, this could be done automatically: if the devices are paired (via Bluetooth) before the jump, they could exchange pressure readings while still on the ground and compute mutual offsets. Or it could be done in post-processing — which is what the testbed is positioned to do — by looking at the pressure readings during the ground/taxi/climb phase where all devices share the same altitude.

### 2. In-Aircraft Pressure Synchronization

A refinement of approach #1. During the climb to altitude, all jumpers are in the same aircraft, at the same altitude. The entire climb phase can be used as a continuous calibration window: the pressure readings should track each other exactly (within relative accuracy), and any persistent offset between device traces is the absolute bias to subtract. Averaging over the full climb (10–15 minutes of data) gives a very clean offset estimate.

This is more robust than a single ground reading because it averages out short-term noise and confirms the offset is stable across the pressure range of interest (ground level down to ~580 hPa at exit altitude).

### 3. GPS-Barometric Fusion for Absolute Reference

The Zaliva/Franchetti paper from CMU describes an algorithm that uses GPS altitude (noisy but unbiased) to continuously calibrate barometric altitude (precise but biased). The principle: GPS provides an absolute reference that doesn't drift with weather, while the barometer provides the smooth, high-resolution relative signal. A Kalman filter or complementary filter blends the two.

The Tempo devices already have GPS (the `$GNRMC` and `$GNGGA` sentences in the logs). The GGA sentences include MSL altitude. While GPS altitude has ±10–30 m noise (or worse), averaged over the ground/climb phase it provides an absolute reference to anchor the barometric readings. Consumer watch altimeters from Suunto and Garmin already do exactly this — Suunto calls it "FusedAlti" and Garmin calls it "Auto Calibration."

For formation skydiving specifically, you don't even need the GPS altitude to be *accurate* — you just need the *difference* between GPS altitude and barometric altitude to be consistent across devices, which lets you solve for the inter-device barometric offsets.

### 4. Differential Pressure Approach (The Reference Sensor Pattern)

The AMSYS application note and the PMC sensor-array paper both describe a pattern where one sensor stays at a known location (ground level) and provides a real-time reference pressure. Any atmospheric pressure changes (weather fronts, diurnal pressure variation) affect both the reference and the moving sensor equally, so the differential measurement cancels them out.

For skydiving this would mean: keep a reference Tempo device (or any BMP390) at the DZ. The aircraft-mounted and jumper-mounted devices measure pressure aloft. The altitude difference is computed from the pressure *ratio* between aloft and ground, not from the absolute pressure of either one. This eliminates weather drift entirely and reduces cross-device error to the relative accuracy spec.

In practice, this requires telemetry (the ground reference needs to communicate its readings to the processing system), but for post-processing in the testbed, the same thing could be accomplished by treating the DZ weather station's pressure log as the reference if one is available.

### 5. Temperature Compensation Refinement

The BMP390's internal temperature sensor measures die temperature, not ambient air temperature. The datasheet notes that this reading is affected by PCB temperature and self-heating, and is "typically above ambient." During freefall, the devices experience rapid airflow cooling and possibly adiabatic heating effects. Two devices in different enclosures (wrist-mounted vs. chest-mounted) may see different thermal environments, causing their TCO-driven offsets to diverge.

If the static offset calibration from the climb phase doesn't hold through freefall, the temperature coefficient is the likely culprit. This can be modeled by computing a TCO correction: for each device, track the temperature reading alongside pressure, and apply a correction of ±0.6 Pa per degree of temperature change from the calibration baseline. This is a second-order effect — probably worth ~1 m at most over a typical jump's temperature range — but it's the next thing to chase after static offsets are removed.

### 6. IIR Filter and Oversampling Considerations

The BMP390's built-in IIR filter is designed for quasi-static environments (suppressing door slams in buildings). In freefall, the sensor experiences genuine rapid pressure changes of ~100 Pa/s. An aggressive IIR filter would lag the true altitude by several meters, and different filter initialization states across devices could cause apparent altitude disagreements that are actually just filter artifacts.

For formation skydiving, the IIR filter should probably be either off or at the lowest coefficient (1), with high oversampling (×8 or ×16) to reduce noise at the ADC level instead. This gives the cleanest raw signal for post-processing alignment. If the Tempo firmware is currently using IIR filtering, that's worth checking — any differences in filter state between devices at the moment of exit would create phantom offsets that decay over several samples.

---

## Recommended Approach for the Testbed

The most immediately actionable approach for the existing test data is **in-aircraft offset calibration** (approach #2). There are 10+ minutes of climb data for all devices on each jump. The algorithm:

1. **Identify the climb phase** (between takeoff and exit) using the `$PST` state or GPS ground speed.
2. **For each timestamp** where all devices have a pressure sample, compute the pairwise pressure differences.
3. **Average those differences** over the climb phase to get a stable offset for each device relative to a reference (e.g., riley's device).
4. **Subtract those offsets** from all pressure data before converting to altitude.

After this correction, the devices should agree to within the ±3 Pa relative accuracy spec (~0.25 m near ground, ~0.5 m at altitude), which is more than sufficient for formation analysis. This could be implemented as a calibration step in the testbed's analysis pipeline — run before EventDetector, producing corrected pressure traces that feed into the altitude calculation.

---

## Sources

- **Bosch BMP390 Datasheet** (BST-BMP390-DS002-07, Rev 1.7, March 2021) — primary source for all sensor specifications, compensation formulae, and recommended settings.
- **Bosch Sensortec Community Forum** — thread on measuring relative altitude with two BMP390 sensors, with official Bosch engineering response.
- **AMSYS Application Note: "MS5611 — Precise Altitude Measurement with Pressure Sensors"** — detailed treatment of the barometric formula variants, practical measurement methods (known-height and unknown-height cases), and the reference-sensor pattern.
- **Zaliva & Franchetti, "Barometric and GPS Altitude Sensor Fusion"** (Carnegie Mellon University) — GPS-barometric fusion algorithm with confidence bounds, no calibration required.
- **PMC Article: "Improvement of Baro Sensors Matrix for Altitude Estimation"** (Sensors, 2022) — multi-sensor array approach using reference sensors and Kalman filtering for centimeter-level altitude precision.
- **PMC Article: "On the Challenges and Potential of Using Barometric Sensors to Track Human Activity"** (Sensors, 2020) — comprehensive survey of barometric sensor error sources, calibration methods, and encounter-network calibration for mobile sensor fleets.