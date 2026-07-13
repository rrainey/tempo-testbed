// components/testbed/JumperAnalysis.tsx
//
// THE single jumper-analysis view — the complete chart set (including the IMU
// Acceleration chart). Rendered by /testcase/[id]/jumper/[name]; there is
// deliberately no second implementation anywhere else, so the charts cannot
// diverge between navigation paths again.
'use client';

import React, { useMemo, useState } from 'react';
import {
  Card, Group, Badge, Stack, Button, Loader, Center, Alert,
  SimpleGrid, Text, Table, Select,
} from '@mantine/core';
import {
  IconAlertCircle, IconPlayerPlay, IconCheck, IconX,
  IconRefresh, IconArrowUp, IconArrowDown, IconMinus,
} from '@tabler/icons-react';
import { JumpAltitudeChart } from '@tempo/core/components/analysis/JumpAltitudeChart';
import { AccelerationChart } from '@tempo/core/components/analysis/AccelerationChart';
import { AltitudeComparisonChart } from '@tempo/core/components/analysis/AltitudeComparisonChart';
import { VelocityBinChart, type DisplayMode } from '@tempo/core/components/analysis/VelocityBinChart';
import { FallRateChart } from '@tempo/core/components/analysis/FallRateChart';
import { GNSSPathMap } from '@tempo/core/components/analysis/GNSSPathMap';
import {
  jumpTimeOrigin, shiftTimeSeries, shiftGPSPoints, shiftEvents,
  shiftAnalysisWindow, shiftTimeField, timeAxisLabel,
} from '@tempo/core/analysis/jump-time';
import { useTestCase, type DiffStatus } from '@/lib/testbed/testcase-context';

export function StatusBadge({ status }: { status: DiffStatus }) {
  const config: Record<DiffStatus, { color: string; icon: React.ReactNode }> = {
    unchanged: { color: 'gray', icon: <IconMinus size={10} /> },
    improved: { color: 'green', icon: <IconArrowUp size={10} /> },
    regressed: { color: 'red', icon: <IconArrowDown size={10} /> },
    changed: { color: 'yellow', icon: <IconRefresh size={10} /> },
    new: { color: 'blue', icon: <IconCheck size={10} /> },
    lost: { color: 'red', icon: <IconX size={10} /> },
  };
  const c = config[status] || config.unchanged;
  return <Badge size="xs" color={c.color} variant="light">{status}</Badge>;
}

export function JumperAnalysis({ jumperName }: { jumperName: string }) {
  const { testCase, analysisResults, analyzing, analyzeJumper } = useTestCase();
  const [fallRateMode, setFallRateMode] = useState<DisplayMode>('raw');

  const jumper = testCase?.jumpers.find(j => j.name === jumperName);
  const result = analysisResults[jumperName] || null;
  const isAnalyzing = analyzing[jumperName] || false;
  const baseline = jumper?.baseline;

  // Jump-elapsed display time base: exit = 0 s, climb negative. The canonical
  // result stays in log time; this is a consistently shifted VIEW of it
  // (series + event markers + analysis window together — never durations).
  // When no exit was detected, origin is null and everything below is the
  // unshifted log-time data.
  const jt = useMemo(() => {
    if (!result) return null;
    const origin = jumpTimeOrigin(result.events);
    const ts = result.timeSeries;
    return {
      origin,
      axisLabel: timeAxisLabel(origin),
      events: shiftEvents(result.events, origin),
      altitude: shiftTimeSeries(ts.altitude, origin),
      vspeed: shiftTimeSeries(ts.vspeed, origin),
      gpsAltitude: shiftTimeSeries(ts.gpsAltitude ?? [], origin),
      staticPressure: shiftTimeSeries(ts.staticPressure ?? [], origin),
      acceleration: shiftTimeSeries(ts.acceleration, origin),
      gps: shiftGPSPoints(ts.gps, origin),
      fallRateSeries: result.fallRateSeries
        ? shiftTimeField(result.fallRateSeries, origin)
        : null,
      velocitySummary: result.velocitySummary
        ? {
            ...result.velocitySummary,
            analysisWindow: shiftAnalysisWindow(result.velocitySummary.analysisWindow, origin),
          }
        : null,
    };
  }, [result]);

  if (!jumper) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        No jumper named &quot;{jumperName}&quot; in this test case
      </Alert>
    );
  }

  if (!jumper.hasFlightData) {
    return (
      <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
        No flight.txt found for {jumperName}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      {/* Controls */}
      <Group>
        <Button
          leftSection={<IconPlayerPlay size={16} />}
          onClick={() => analyzeJumper(jumperName)}
          loading={isAnalyzing}
        >
          Run Analysis
        </Button>
        {result && (
          <Button
            leftSection={<IconCheck size={16} />}
            color="green"
            variant="light"
            onClick={() => analyzeJumper(jumperName, true)}
            loading={isAnalyzing}
          >
            Accept as Baseline
          </Button>
        )}
      </Group>

      {/* Analysis results */}
      {isAnalyzing && !result && (
        <Card withBorder p="lg">
          <Center><Loader size="md" /></Center>
          <Text ta="center" c="dimmed" mt="sm">Analyzing flight data...</Text>
        </Card>
      )}

      {result && jt && (
        <>
          {/* Event Summary — times in jump-elapsed base (exit = 0 s) when an
              exit was inferred; the Exit card's subtitle bridges to log time. */}
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
            <MetricCard
              label="Exit"
              value={jt.events.exitOffsetSec != null
                ? `${jt.events.exitOffsetSec.toFixed(1)}s`
                : 'Not detected'}
              subtitle={jt.origin !== null
                ? `log ${result.events.exitOffsetSec.toFixed(1)}s`
                  + (result.events.exitAltitudeFt
                    ? ` · ${result.events.exitAltitudeFt.toLocaleString()} ft` : '')
                : (result.events.exitAltitudeFt
                    ? `${result.events.exitAltitudeFt.toLocaleString()} ft` : undefined)}
              detected={jt.events.exitOffsetSec != null}
            />
            <MetricCard
              label="Deployment"
              value={jt.events.deploymentOffsetSec != null
                ? `${jt.events.deploymentOffsetSec.toFixed(1)}s`
                : 'Not detected'}
              subtitle={result.events.deployAltitudeFt
                ? `${result.events.deployAltitudeFt.toLocaleString()} ft`
                : undefined}
              detected={jt.events.deploymentOffsetSec != null}
            />
            <MetricCard
              label="Landing"
              value={jt.events.landingOffsetSec != null
                ? `${jt.events.landingOffsetSec.toFixed(1)}s`
                : 'Not detected'}
              detected={jt.events.landingOffsetSec != null}
            />
            <MetricCard
              label="Max Descent"
              value={result.events.maxDescentRateFpm != null
                ? `${Math.round(result.events.maxDescentRateFpm)} fpm`
                : 'N/A'}
              subtitle={result.events.maxDescentRateFpm
                ? `${Math.round(result.events.maxDescentRateFpm / 88)} mph`
                : undefined}
              detected={result.events.maxDescentRateFpm != null}
            />
          </SimpleGrid>

          {/* Log metadata */}
          <Card withBorder p="md">
            <Text fw={500} mb="xs">Log Metadata</Text>
            <Group gap="lg">
              <Text size="sm" c="dimmed">
                Duration: <Text span fw={500}>{result.timeSeries.duration.toFixed(1)}s</Text>
              </Text>
              <Text size="sm" c="dimmed">
                Sample Rate: <Text span fw={500}>{result.timeSeries.sampleRate.toFixed(1)} Hz</Text>
              </Text>
              <Text size="sm" c="dimmed">
                GPS: <Text span fw={500}>{result.timeSeries.hasGPS ? 'Yes' : 'No'}</Text>
              </Text>
              <Text size="sm" c="dimmed">
                Version: <Text span fw={500}>{result.timeSeries.logString} (v{result.timeSeries.logVersion})</Text>
              </Text>
              <Text size="sm" c="dimmed">
                Surface: <Text span fw={500}>{result.timeSeries.dzSurfacePressureAltitude_m?.toFixed(1)}m</Text>
              </Text>
            </Group>
          </Card>

          {/* Altitude Chart */}
          {jt.altitude.length > 0 && (
            <JumpAltitudeChart
              altitudeData={jt.altitude}
              vspeedData={jt.vspeed}
              exitOffsetSec={jt.events.exitOffsetSec ?? undefined}
              deploymentOffsetSec={jt.events.deploymentOffsetSec ?? undefined}
              landingOffsetSec={jt.events.landingOffsetSec ?? undefined}
              showVSpeed={false}
              timeAxisLabel={jt.axisLabel}
            />
          )}

          {/* IMU Acceleration Chart */}
          {jt.acceleration.length > 0 && (
            <AccelerationChart
              accelerationData={jt.acceleration}
              exitOffsetSec={jt.events.exitOffsetSec ?? undefined}
              deploymentOffsetSec={jt.events.deploymentOffsetSec ?? undefined}
              landingOffsetSec={jt.events.landingOffsetSec ?? undefined}
              timeAxisLabel={jt.axisLabel}
            />
          )}

          {/* Altitude Source Comparison Chart */}
          {jt.altitude.length > 0 && (
            <AltitudeComparisonChart
              baroAltitudeData={jt.altitude}
              gpsAltitudeData={jt.gpsAltitude}
              staticPressureData={jt.staticPressure}
              dzSurfacePressureAltitude_m={result.timeSeries.dzSurfacePressureAltitude_m ?? 0}
              timeAxisLabel={jt.axisLabel}
            />
          )}

          {/* GNSS Flight Path Map */}
          {result.timeSeries.hasGPS && jt.gps.length > 0 && (
            <GNSSPathMap
              gpsData={jt.gps}
              exitOffsetSec={jt.events.exitOffsetSec ?? undefined}
              deploymentOffsetSec={jt.events.deploymentOffsetSec ?? undefined}
              landingOffsetSec={jt.events.landingOffsetSec ?? undefined}
            />
          )}

          {/* Fall rate display mode — controls both fall rate charts below */}
          {result.velocityBins && result.velocitySummary && (
            <Card withBorder p="sm">
              <Group justify="space-between" align="center">
                <div>
                  <Text fw={500} size="sm">Fall Rate Display Mode</Text>
                  <Text size="xs" c="dimmed">
                    Applies to both the fall rate vs. time and distribution charts
                  </Text>
                </div>
                <Select
                  value={fallRateMode}
                  onChange={(value) => value && setFallRateMode(value as DisplayMode)}
                  data={[
                    { value: 'raw', label: 'Raw Fall Rate' },
                    { value: 'calibrated', label: 'Calibrated Fall Rate' },
                    { value: 'both', label: 'Both (Comparison)' },
                  ]}
                  allowDeselect={false}
                  w={240}
                />
              </Group>
            </Card>
          )}

          {/* Fall Rate vs Time Chart */}
          {jt.fallRateSeries && jt.fallRateSeries.length > 0 && jt.velocitySummary && (
            <FallRateChart
              data={jt.fallRateSeries}
              displayMode={fallRateMode}
              exitOffsetSec={jt.events.exitOffsetSec ?? undefined}
              deploymentOffsetSec={jt.events.deploymentOffsetSec ?? undefined}
              landingOffsetSec={jt.events.landingOffsetSec ?? undefined}
              analysisWindow={jt.velocitySummary.analysisWindow}
              timeAxisLabel={jt.axisLabel}
            />
          )}

          {/* Velocity Bin Chart (x axis is dwell time — durations, unshifted;
              only the analysis-window badge reflects the jump time base) */}
          {result.velocityBins && jt.velocitySummary && (
            <VelocityBinChart
              data={result.velocityBins}
              summary={jt.velocitySummary}
              displayMode={fallRateMode}
            />
          )}

          {/* Diff Table */}
          {result.diff && <DiffTable diff={result.diff} />}

          {/* Baseline comparison if no diff (baseline hasn't been set yet) */}
          {!result.diff && baseline?.analyzedAt && (
            <Alert color="blue" icon={<IconAlertCircle size={16} />}>
              Existing baseline found (analyzed {new Date(baseline.analyzedAt).toLocaleString()}).
              Click &quot;Accept as Baseline&quot; to update it with the current results.
            </Alert>
          )}
        </>
      )}

      {/* Show baseline summary if no analysis has been run yet */}
      {!result && baseline && baseline.analyzedAt && (
        <Card withBorder p="md">
          <Text fw={500} mb="sm">Existing Baseline</Text>
          <Text size="sm" c="dimmed">
            Analyzed: {new Date(baseline.analyzedAt).toLocaleString()}
          </Text>
          <Text size="sm" c="dimmed">
            Version: {baseline.analysisVersion}
          </Text>
          <SimpleGrid cols={3} mt="sm">
            <Text size="sm">
              Exit: {baseline.events.exitOffsetSec != null
                ? `${baseline.events.exitOffsetSec.toFixed(1)}s`
                : 'null'}
            </Text>
            <Text size="sm">
              Deploy: {baseline.events.deploymentOffsetSec != null
                ? `${baseline.events.deploymentOffsetSec.toFixed(1)}s`
                : 'null'}
            </Text>
            <Text size="sm">
              Landing: {baseline.events.landingOffsetSec != null
                ? `${baseline.events.landingOffsetSec.toFixed(1)}s`
                : 'null'}
            </Text>
          </SimpleGrid>
        </Card>
      )}
    </Stack>
  );
}

function MetricCard({
  label, value, subtitle, detected,
}: {
  label: string;
  value: string;
  subtitle?: string;
  detected: boolean;
}) {
  return (
    <Card withBorder p="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600} size="lg" c={detected ? undefined : 'red'}>
        {value}
      </Text>
      {subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}
    </Card>
  );
}

function DiffTable({ diff }: { diff: any }) {
  const significantFields = diff.fields.filter(
    (f: any) => f.status !== 'unchanged'
  );

  if (significantFields.length === 0) {
    return (
      <Card withBorder p="md">
        <Group gap="xs">
          <IconCheck size={16} color="green" />
          <Text size="sm">All fields match baseline within tolerance</Text>
        </Group>
      </Card>
    );
  }

  return (
    <Card withBorder p="md">
      <Text fw={500} mb="sm">
        Diff vs Baseline
        <StatusBadge status={diff.overallStatus} />
      </Text>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Field</Table.Th>
            <Table.Th>Baseline</Table.Th>
            <Table.Th>Current</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Delta</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {diff.fields.map((f: any) => (
            <Table.Tr key={f.field}>
              <Table.Td><Text size="sm" fw={500}>{f.field}</Text></Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {f.baselineValue !== null ? formatValue(f.baselineValue) : '—'}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={f.status !== 'unchanged' ? 600 : undefined}>
                  {f.currentValue !== null ? formatValue(f.currentValue) : '—'}
                </Text>
              </Table.Td>
              <Table.Td><StatusBadge status={f.status} /></Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {f.delta != null ? (f.delta > 0 ? '+' : '') + formatValue(f.delta) : ''}
                  {f.tolerance != null ? ` (±${f.tolerance})` : ''}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function formatValue(v: any): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
  }
  return String(v);
}
