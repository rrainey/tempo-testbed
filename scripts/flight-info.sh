#!/usr/bin/env bash
#
# flight-info.sh — Print essential stats from a Tempo flight log file.
#
# Usage: flight-info.sh <flight.txt>
#
# Reports:
#   - GNSS time/date extents (first and last fix)
#   - Precise UTC timestamp of exit (from $PST JUMPED or accel fallback)

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $(basename "$0") <flight.txt>" >&2
    exit 1
fi

LOGFILE="$1"

if [[ ! -f "$LOGFILE" ]]; then
    echo "Error: file not found: $LOGFILE" >&2
    exit 1
fi

# --- helper: format NMEA time (HHMMSS.SS) into HH:MM:SS.SS ---
fmt_time() {
    local raw="$1"
    local hh="${raw:0:2}"
    local mm="${raw:2:2}"
    local ss="${raw:4}"
    echo "${hh}:${mm}:${ss}"
}

# --- helper: format NMEA date (DDMMYY) into YYYY-MM-DD ---
fmt_date() {
    local raw="$1"
    local dd="${raw:0:2}"
    local mm="${raw:2:2}"
    local yy="${raw:4:2}"
    echo "20${yy}-${mm}-${dd}"
}

# --- Extract GNSS date from first RMC record (field 10, 1-indexed) ---
rmc_line=$(grep -m1 '^\$G[NP]RMC,' "$LOGFILE" 2>/dev/null || true)
gnss_date=""
if [[ -n "$rmc_line" ]]; then
    raw_date=$(echo "$rmc_line" | cut -d',' -f10)
    if [[ -n "$raw_date" ]]; then
        gnss_date=$(fmt_date "$raw_date")
    fi
fi

# --- Extract first and last GGA timestamps ---
first_gga=$(grep -m1 '^\$G[NP]GGA,' "$LOGFILE" 2>/dev/null || true)
last_gga=$(grep '^\$G[NP]GGA,' "$LOGFILE" 2>/dev/null | tail -1 || true)

if [[ -z "$first_gga" ]]; then
    echo "No GNSS fix records (GGA) found in $LOGFILE" >&2
    exit 1
fi

first_time_raw=$(echo "$first_gga" | cut -d',' -f2)
last_time_raw=$(echo "$last_gga" | cut -d',' -f2)

first_time=$(fmt_time "$first_time_raw")
last_time=$(fmt_time "$last_time_raw")

# --- Count total GGA records ---
gga_count=$(grep -c '^\$G[NP]GGA,' "$LOGFILE" 2>/dev/null || echo 0)

# --- Compute duration ---
to_seconds() {
    local raw="$1"
    local hh=$((10#${raw:0:2}))
    local mm=$((10#${raw:2:2}))
    local ss=${raw:4}
    echo "$hh * 3600 + $mm * 60 + $ss" | bc
}

start_s=$(to_seconds "$first_time_raw")
end_s=$(to_seconds "$last_time_raw")
dur=$(echo "$end_s - $start_s" | bc)

if (( $(echo "$dur < 0" | bc -l) )); then
    dur=$(echo "$dur + 86400" | bc)
fi

dur_min=$(echo "scale=1; $dur / 60" | bc)

# ---------------------------------------------------------------------------
# Compute precise UTC timestamp of exit (PST JUMPED or acceleration fallback)
#
# Algorithm:
#   1. Find the device-ms timestamp of the exit event ($PST→JUMPED, or first
#      sustained <0.8g from $PIMU records).
#   2. Take the UTC time from the most recent preceding $GNGGA record.
#   3. Take the device-ms from the $PTH record immediately following that GGA.
#   4. exit_utc = gga_utc + (event_ms − pth_ms)
# ---------------------------------------------------------------------------
exit_result=$(awk -F',' '
    # --- Track GNSS date from RMC ---
    /^\$G[NP]RMC,/ && gnss_date == "" {
        raw = $10
        gnss_date = "20" substr(raw,5,2) "-" substr(raw,3,2) "-" substr(raw,1,2)
    }

    # --- Track most recent GGA UTC time ---
    /^\$G[NP]GGA,/ {
        last_gga_time = $2
    }

    # --- Track most recent PTH device-ms (strip checksum) ---
    /^\$PTH,/ {
        val = $2
        sub(/\*.*/, "", val)
        last_pth_ms = val + 0
    }

    # --- Primary: $PST JUMPED (always captures, overrides accel fallback) ---
    /^\$PST,/ && $4 ~ /^JUMPED/ && !pst_found {
        pst_ms       = $2 + 0
        pst_gga_time = last_gga_time
        pst_pth_ms   = last_pth_ms
        pst_found    = 1
    }

    # --- Fallback: sustained low-g from $PIMU (>=10 consecutive samples <0.8g) ---
    /^\$PIMU,/ && !accel_found {
        ax = $3 + 0.0; ay = $4 + 0.0; az = $5 + 0.0
        mag = sqrt(ax*ax + ay*ay + az*az)
        if (mag < 9.81 * 0.8) {
            low_g_count++
            if (low_g_count == 1) {
                first_low_g_ms = $2 + 0
                fg_gga_time = last_gga_time
                fg_pth_ms   = last_pth_ms
            }
            if (low_g_count >= 10) {
                accel_ms       = first_low_g_ms
                accel_gga_time = fg_gga_time
                accel_pth_ms   = fg_pth_ms
                accel_found    = 1
            }
        } else {
            low_g_count = 0
        }
    }

    END {
        # Use whichever event occurred first (lowest device-ms timestamp)
        if (pst_found && accel_found) {
            if (accel_ms <= pst_ms) {
                event_ms       = accel_ms
                event_gga_time = accel_gga_time
                event_pth_ms   = accel_pth_ms
                src = "ACCEL"
            } else {
                event_ms       = pst_ms
                event_gga_time = pst_gga_time
                event_pth_ms   = pst_pth_ms
                src = "PST"
            }
        } else if (pst_found) {
            event_ms       = pst_ms
            event_gga_time = pst_gga_time
            event_pth_ms   = pst_pth_ms
            src = "PST"
        } else if (accel_found) {
            event_ms       = accel_ms
            event_gga_time = accel_gga_time
            event_pth_ms   = accel_pth_ms
            src = "ACCEL"
        } else {
            print "SRC=NONE"
            exit
        }

        delta_ms = event_ms - event_pth_ms

        # Parse GGA time (HHMMSS.SS) into total milliseconds
        hh = substr(event_gga_time, 1, 2) + 0
        mm = substr(event_gga_time, 3, 2) + 0
        ss_frac = substr(event_gga_time, 5) + 0.0
        total_ms = (hh * 3600 + mm * 60 + ss_frac) * 1000 + delta_ms

        # Clamp to day
        if (total_ms >= 86400000) total_ms -= 86400000
        if (total_ms < 0)        total_ms += 86400000

        out_hh = int(total_ms / 3600000);          total_ms -= out_hh * 3600000
        out_mm = int(total_ms / 60000);             total_ms -= out_mm * 60000
        out_ss = int(total_ms / 1000)
        out_ms = int(total_ms - out_ss * 1000 + 0.5)

        printf "SRC=%s\n",   src
        printf "TIME=%02d:%02d:%02d.%03d\n", out_hh, out_mm, out_ss, out_ms
        if (gnss_date != "") printf "DATE=%s\n", gnss_date
        printf "DELTA_MS=%d\n", delta_ms
        printf "EVENT_MS=%d\n", event_ms
    }
' "$LOGFILE")

exit_src=$(echo "$exit_result" | grep '^SRC=' | cut -d= -f2 || true)
exit_time=$(echo "$exit_result" | grep '^TIME=' | cut -d= -f2 || true)
exit_date=$(echo "$exit_result" | grep '^DATE=' | cut -d= -f2 || true)
exit_delta=$(echo "$exit_result" | grep '^DELTA_MS=' | cut -d= -f2 || true)

# Use RMC date from earlier extraction if awk didn't find one
if [[ -z "$exit_date" && -n "$gnss_date" ]]; then
    exit_date="$gnss_date"
fi

# --- Output ---
echo "=== Flight Log: $(basename "$LOGFILE") ==="
echo ""

if [[ -n "$gnss_date" ]]; then
    echo "  Date (UTC):       $gnss_date"
    echo "  First GNSS fix:   ${gnss_date}T${first_time}Z"
    echo "  Last GNSS fix:    ${gnss_date}T${last_time}Z"
else
    echo "  Date (UTC):       (no RMC record — date unavailable)"
    echo "  First GNSS fix:   ${first_time} UTC"
    echo "  Last GNSS fix:    ${last_time} UTC"
fi

echo "  Duration:         ${dur_min} min (${dur} sec)"
echo "  GNSS fix count:   ${gga_count}"

echo ""
case "$exit_src" in
    PST)
        if [[ -n "$exit_date" ]]; then
            echo "  Exit (PST):       ${exit_date}T${exit_time}Z  (GGA+${exit_delta}ms)"
        else
            echo "  Exit (PST):       ${exit_time} UTC  (GGA+${exit_delta}ms)"
        fi
        ;;
    ACCEL)
        if [[ -n "$exit_date" ]]; then
            echo "  Exit (accel):     ${exit_date}T${exit_time}Z  (GGA+${exit_delta}ms)"
        else
            echo "  Exit (accel):     ${exit_time} UTC  (GGA+${exit_delta}ms)"
        fi
        ;;
    *)
        echo "  Exit:             (not detected)"
        ;;
esac
