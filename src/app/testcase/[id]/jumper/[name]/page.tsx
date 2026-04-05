// app/testcase/[id]/jumper/[name]/page.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Title, Text, Card, Group, Badge, Stack, Button,
  Loader, Center, Alert, SimpleGrid, Anchor, Table
} from '@mantine/core';
import {
  IconAlertCircle, IconPlayerPlay, IconCheck, IconArrowLeft,
  IconRefresh, IconArrowUp, IconArrowDown, IconMinus, IconX
} from '@tabler/icons-react';
import Link from 'next/link';
import { JumpAltitudeChart } from '@tempo/core/components/analysis/JumpAltitudeChart';
import { AltitudeComparisonChart } from '@tempo/core/components/analysis/AltitudeComparisonChart';
import { VelocityBinChart } from '@tempo/core/components/analysis/VelocityBinChart';
import { notifications } from '@mantine/notifications';

interface AnalysisResult {
  events: any;
  velocityBins: any[] | null;
  velocitySummary: any | null;
  baseline: any;
  diff: any | null;
  accepted: boolean;
  timeSeries: {
    altitude: { timestamp: number; value: number }[];
    vspeed: { timestamp: number; value: number }[];
    gps: any[];
    gpsAltitude: { timestamp: number; value: number }[];
    staticPressure: { timestamp: number; value: number }[];
    duration: number;
    sampleRate: number;
    hasGPS: boolean;
    logVersion: number;
    logString: string;
    dzSurfacePressureAltitude_m: number;
  };
}

type DiffStatus = 'unchanged' | 'improved' | 'regressed' | 'changed' | 'new' | 'lost';

export default function JumperDetailPage() {
  const params = useParams();
  const testCaseId = params.id as string;
  const jumperName = params.name as string;

  const [testCase, setTestCase] = useState<any>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load test case metadata
  useEffect(() => {
    fetch(`/api/testcases/${testCaseId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setTestCase(data.testCase);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [testCaseId]);

  const analyze = useCallback(async (accept = false) => {
    setAnalyzing(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCaseId, jumperName, accept }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);

      if (accept) {
        notifications.show({ message: `Baseline saved for ${jumperName}`, color: 'green' });
        // Reload test case
        const tcResponse = await fetch(`/api/testcases/${testCaseId}`);
        const tcData = await tcResponse.json();
        if (tcData.testCase) setTestCase(tcData.testCase);
      }
    } catch (err) {
      notifications.show({
        title: 'Analysis failed',
        message: err instanceof Error ? err.message : 'Unknown error',
        color: 'red',
      });
    } finally {
      setAnalyzing(false);
    }
  }, [testCaseId, jumperName]);

  if (loading) return <Center h={400}><Loader size="lg" /></Center>;
  if (error || !testCase) {
    return (
      <Container size="lg" py="xl">
        <Alert icon={<IconAlertCircle size={16} />} color="red">{error || 'Not found'}</Alert>
      </Container>
    );
  }

  const jumperData = testCase.jumpers?.find((j: any) => j.name === jumperName);

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        {/* Breadcrumb */}
        <Group gap="xs">
          <Anchor component={Link} href="/" size="sm" c="dimmed">All Tests</Anchor>
          <Text size="sm" c="dimmed">/</Text>
          <Anchor component={Link} href={`/testcase/${testCaseId}`} size="sm" c="dimmed">
            {testCase.metadata.name}
          </Anchor>
          <Text size="sm" c="dimmed">/</Text>
          <Text size="sm">{jumperName}</Text>
        </Group>

        {/* Header */}
        <Group justify="space-between">
          <div>
            <Title order={2} style={{ color: '#ddff55' }}>{jumperName}</Title>
            <Text c="dimmed" size="sm">{testCase.metadata.name}</Text>
          </div>
          <Group>
            <Button
              leftSection={<IconPlayerPlay size={16} />}
              onClick={() => analyze(false)}
              loading={analyzing}
            >
              Run Analysis
            </Button>
            {result && (
              <Button
                leftSection={<IconCheck size={16} />}
                color="green"
                variant="light"
                onClick={() => analyze(true)}
                loading={analyzing}
              >
                Accept as Baseline
              </Button>
            )}
          </Group>
        </Group>

        {/* Analyzing state */}
        {analyzing && !result && (
          <Card withBorder p="lg">
            <Center><Loader size="md" /></Center>
            <Text ta="center" c="dimmed" mt="sm">Analyzing flight data...</Text>
          </Card>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Event Summary Cards */}
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              <MetricCard
                label="Exit"
                value={result.events.exitOffsetSec != null
                  ? `${result.events.exitOffsetSec.toFixed(1)}s`
                  : 'Not detected'}
                subtitle={result.events.exitAltitudeFt
                  ? `${result.events.exitAltitudeFt.toLocaleString()} ft`
                  : undefined}
                detected={result.events.exitOffsetSec != null}
              />
              <MetricCard
                label="Deployment"
                value={result.events.deploymentOffsetSec != null
                  ? `${result.events.deploymentOffsetSec.toFixed(1)}s`
                  : 'Not detected'}
                subtitle={result.events.deployAltitudeFt
                  ? `${result.events.deployAltitudeFt.toLocaleString()} ft`
                  : undefined}
                detected={result.events.deploymentOffsetSec != null}
              />
              <MetricCard
                label="Landing"
                value={result.events.landingOffsetSec != null
                  ? `${result.events.landingOffsetSec.toFixed(1)}s`
                  : 'Not detected'}
                detected={result.events.landingOffsetSec != null}
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

            {/* Log Metadata */}
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
              </Group>
            </Card>

            {/* Altitude Chart */}
            {result.timeSeries.altitude.length > 0 && (
              <JumpAltitudeChart
                altitudeData={result.timeSeries.altitude}
                vspeedData={result.timeSeries.vspeed}
                exitOffsetSec={result.events.exitOffsetSec ?? undefined}
                deploymentOffsetSec={result.events.deploymentOffsetSec ?? undefined}
                landingOffsetSec={result.events.landingOffsetSec ?? undefined}
                showVSpeed={false}
              />
            )}

            {/* Altitude Source Comparison Chart */}
            {result.timeSeries.altitude.length > 0 && (
              <AltitudeComparisonChart
                baroAltitudeData={result.timeSeries.altitude}
                gpsAltitudeData={result.timeSeries.gpsAltitude ?? []}
                staticPressureData={result.timeSeries.staticPressure ?? []}
                dzSurfacePressureAltitude_m={result.timeSeries.dzSurfacePressureAltitude_m ?? 0}
              />
            )}

            {/* Velocity Bin Chart */}
            {result.velocityBins && result.velocitySummary && (
              <VelocityBinChart
                data={result.velocityBins}
                summary={result.velocitySummary}
              />
            )}

            {/* Diff Table */}
            {result.diff && <DiffTable diff={result.diff} />}
          </>
        )}

        {/* Show baseline if no analysis run yet */}
        {!result && jumperData?.baseline?.analyzedAt && (
          <Card withBorder p="md">
            <Text fw={500} mb="sm">Existing Baseline</Text>
            <Text size="sm" c="dimmed">
              Analyzed: {new Date(jumperData.baseline.analyzedAt).toLocaleString()}
            </Text>
            <SimpleGrid cols={3} mt="sm">
              <Text size="sm">
                Exit: {jumperData.baseline.events.exitOffsetSec != null
                  ? `${jumperData.baseline.events.exitOffsetSec.toFixed(1)}s`
                  : 'null'}
              </Text>
              <Text size="sm">
                Deploy: {jumperData.baseline.events.deploymentOffsetSec != null
                  ? `${jumperData.baseline.events.deploymentOffsetSec.toFixed(1)}s`
                  : 'null'}
              </Text>
              <Text size="sm">
                Landing: {jumperData.baseline.events.landingOffsetSec != null
                  ? `${jumperData.baseline.events.landingOffsetSec.toFixed(1)}s`
                  : 'null'}
              </Text>
            </SimpleGrid>
          </Card>
        )}
      </Stack>
    </Container>
  );
}

function MetricCard({ label, value, subtitle, detected }: {
  label: string; value: string; subtitle?: string; detected: boolean;
}) {
  return (
    <Card withBorder p="md">
      <Text size="xs" c="dimmed">{label}</Text>
      <Text fw={600} size="lg" c={detected ? undefined : 'red'}>{value}</Text>
      {subtitle && <Text size="xs" c="dimmed">{subtitle}</Text>}
    </Card>
  );
}

function StatusBadge({ status }: { status: DiffStatus }) {
  const config: Record<DiffStatus, { color: string }> = {
    unchanged: { color: 'gray' },
    improved: { color: 'green' },
    regressed: { color: 'red' },
    changed: { color: 'yellow' },
    new: { color: 'blue' },
    lost: { color: 'red' },
  };
  const c = config[status] || config.unchanged;
  return <Badge size="xs" color={c.color} variant="light">{status}</Badge>;
}

function DiffTable({ diff }: { diff: any }) {
  const significantFields = diff.fields.filter((f: any) => f.status !== 'unchanged');

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
        Diff vs Baseline <StatusBadge status={diff.overallStatus} />
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
                  {f.baselineValue !== null ? formatValue(f.baselineValue) : '\u2014'}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={f.status !== 'unchanged' ? 600 : undefined}>
                  {f.currentValue !== null ? formatValue(f.currentValue) : '\u2014'}
                </Text>
              </Table.Td>
              <Table.Td><StatusBadge status={f.status} /></Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {f.delta != null ? (f.delta > 0 ? '+' : '') + formatValue(f.delta) : ''}
                  {f.tolerance != null ? ` (\u00B1${f.tolerance})` : ''}
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
