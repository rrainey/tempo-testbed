// app/testcase/[id]/page.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Title, Text, Card, Group, Badge, Stack, Button,
  Loader, Center, Alert, Divider, Table, Paper, Tabs, Anchor,
  SimpleGrid, Skeleton
} from '@mantine/core';
import {
  IconAlertCircle, IconPlayerPlay, IconCheck, IconX,
  IconArrowLeft, IconDownload, IconRefresh, IconArrowUp,
  IconArrowDown, IconMinus
} from '@tabler/icons-react';
import Link from 'next/link';
import { JumpAltitudeChart } from '@/components/analysis/JumpAltitudeChart';
import { AltitudeComparisonChart } from '@/components/analysis/AltitudeComparisonChart';
import { VelocityBinChart } from '@/components/analysis/VelocityBinChart';
import { notifications } from '@mantine/notifications';

interface TestCaseData {
  id: string;
  metadata: {
    name: string;
    description: string;
    dropzone: { name: string; lat_deg: number; lon_deg: number; elevation_m: number };
    jumpers: string[];
    baseJumper: string;
    isSolo: boolean;
    tags: string[];
  };
  jumpers: {
    name: string;
    hasFlightData: boolean;
    baseline: any;
  }[];
  hasBaseline: boolean;
}

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

export default function TestCasePage() {
  const params = useParams();
  const testCaseId = params.id as string;

  const [testCase, setTestCase] = useState<TestCaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-jumper analysis results
  const [analysisResults, setAnalysisResults] = useState<Record<string, AnalysisResult>>({});
  const [analyzing, setAnalyzing] = useState<Record<string, boolean>>({});

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

  // Run analysis for a specific jumper
  const analyzeJumper = useCallback(async (jumperName: string, accept = false) => {
    setAnalyzing(prev => ({ ...prev, [jumperName]: true }));

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCaseId, jumperName, accept }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setAnalysisResults(prev => ({ ...prev, [jumperName]: data }));

      if (accept) {
        notifications.show({
          message: `Baseline saved for ${jumperName}`,
          color: 'green',
        });
        // Reload test case to reflect updated baseline
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
      setAnalyzing(prev => ({ ...prev, [jumperName]: false }));
    }
  }, [testCaseId]);

  // Analyze all jumpers
  const analyzeAll = useCallback(async () => {
    if (!testCase) return;
    for (const jumper of testCase.jumpers) {
      if (jumper.hasFlightData) {
        await analyzeJumper(jumper.name);
      }
    }
  }, [testCase, analyzeJumper]);

  // Accept all results as baseline
  const acceptAll = useCallback(async () => {
    if (!testCase) return;
    for (const jumper of testCase.jumpers) {
      if (jumper.hasFlightData && analysisResults[jumper.name]) {
        await analyzeJumper(jumper.name, true);
      }
    }
  }, [testCase, analysisResults, analyzeJumper]);

  if (loading) return <Center h={400}><Loader size="lg" /></Center>;
  if (error || !testCase) {
    return (
      <Container size="lg" py="xl">
        <Alert icon={<IconAlertCircle size={16} />} color="red">{error || 'Not found'}</Alert>
      </Container>
    );
  }

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between">
          <div>
            <Group gap="xs" mb="xs">
              <Anchor component={Link} href="/" size="sm" c="dimmed">
                <Group gap={4}><IconArrowLeft size={14} /> All Tests</Group>
              </Anchor>
            </Group>
            <Title order={2} style={{ color: '#ddff55' }}>{testCase.metadata.name}</Title>
            <Text c="dimmed" size="sm">{testCase.metadata.description}</Text>
          </div>
          <Group>
            {!testCase.metadata.isSolo && (
              <Button
                component={Link}
                href={`/formation/${testCaseId}`}
                leftSection={<IconPlayerPlay size={16} />}
                variant="light"
                color="violet"
              >
                Formation Playback
              </Button>
            )}
            <Button
              leftSection={<IconRefresh size={16} />}
              onClick={analyzeAll}
              loading={Object.values(analyzing).some(Boolean)}
            >
              Analyze All
            </Button>
            {Object.keys(analysisResults).length > 0 && (
              <Button
                leftSection={<IconCheck size={16} />}
                color="green"
                variant="light"
                onClick={acceptAll}
              >
                Accept All
              </Button>
            )}
          </Group>
        </Group>

        {/* Dropzone info */}
        <Group gap="xs">
          <Badge variant="outline">{testCase.metadata.dropzone.name}</Badge>
          <Badge variant="outline" color="gray">
            {testCase.metadata.dropzone.elevation_m.toFixed(0)}m MSL
          </Badge>
          {testCase.metadata.tags.map(tag => (
            <Badge key={tag} size="xs" variant="dot" color="gray">{tag}</Badge>
          ))}
        </Group>

        {/* Per-jumper tabs */}
        <Tabs defaultValue={testCase.jumpers[0]?.name}>
          <Tabs.List>
            {testCase.jumpers.map(j => (
              <Tabs.Tab key={j.name} value={j.name}
                rightSection={
                  analysisResults[j.name]?.diff
                    ? <StatusBadge status={analysisResults[j.name].diff.overallStatus} />
                    : null
                }
              >
                {j.name}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {testCase.jumpers.map(j => (
            <Tabs.Panel key={j.name} value={j.name} pt="md">
              <JumperPanel
                jumperName={j.name}
                hasFlightData={j.hasFlightData}
                baseline={j.baseline}
                result={analysisResults[j.name] || null}
                isAnalyzing={analyzing[j.name] || false}
                onAnalyze={() => analyzeJumper(j.name)}
                onAccept={() => analyzeJumper(j.name, true)}
              />
            </Tabs.Panel>
          ))}
        </Tabs>
      </Stack>
    </Container>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function StatusBadge({ status }: { status: DiffStatus }) {
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

interface JumperPanelProps {
  jumperName: string;
  hasFlightData: boolean;
  baseline: any;
  result: AnalysisResult | null;
  isAnalyzing: boolean;
  onAnalyze: () => void;
  onAccept: () => void;
}

function JumperPanel({
  jumperName, hasFlightData, baseline, result, isAnalyzing, onAnalyze, onAccept
}: JumperPanelProps) {
  if (!hasFlightData) {
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
          onClick={onAnalyze}
          loading={isAnalyzing}
        >
          Run Analysis
        </Button>
        {result && (
          <Button
            leftSection={<IconCheck size={16} />}
            color="green"
            variant="light"
            onClick={onAccept}
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

      {result && (
        <>
          {/* Event Summary */}
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
  label, value, subtitle, detected
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
