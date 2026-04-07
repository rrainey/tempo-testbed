// app/diff/page.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Container, Title, Text, Card, Group, Badge, Stack, Button,
  Loader, Center, Alert, Table, Anchor
} from '@mantine/core';
import {
  IconAlertCircle, IconRefresh, IconCheck, IconArrowLeft,
  IconArrowUp, IconArrowDown, IconMinus, IconX
} from '@tabler/icons-react';
import Link from 'next/link';
import { notifications } from '@mantine/notifications';

type DiffStatus = 'unchanged' | 'improved' | 'regressed' | 'changed' | 'new' | 'lost';

interface FieldDiff {
  field: string;
  baselineValue: any;
  currentValue: any;
  status: DiffStatus;
  delta?: number;
  tolerance?: number;
}

interface JumperResult {
  testCaseId: string;
  testCaseName: string;
  jumperName: string;
  fields: FieldDiff[];
  overallStatus: DiffStatus;
  events: any;
  error?: string;
}

export default function DiffDashboardPage() {
  const [testCases, setTestCases] = useState<any[]>([]);
  const [results, setResults] = useState<JumperResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Load test cases
  useEffect(() => {
    fetch('/api/testcases')
      .then(r => r.json())
      .then(data => {
        setTestCases(data.testCases || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Analyze all jumpers across all test cases
  const analyzeAll = useCallback(async () => {
    setAnalyzing(true);
    const newResults: JumperResult[] = [];

    for (const tc of testCases) {
      // Load test case detail to get jumper list
      const tcResp = await fetch(`/api/testcases/${tc.id}`);
      const tcData = await tcResp.json();
      if (!tcData.testCase) continue;

      for (const jumper of tcData.testCase.jumpers) {
        if (!jumper.hasFlightData) continue;

        try {
          const resp = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testCaseId: tc.id, jumperName: jumper.name }),
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error);

          if (data.diff) {
            newResults.push({
              testCaseId: tc.id,
              testCaseName: tc.metadata.name,
              jumperName: jumper.name,
              fields: data.diff.fields,
              overallStatus: data.diff.overallStatus,
              events: data.events,
            });
          } else {
            // No baseline to compare against — show as "new"
            newResults.push({
              testCaseId: tc.id,
              testCaseName: tc.metadata.name,
              jumperName: jumper.name,
              fields: [],
              overallStatus: 'new',
              events: data.events,
            });
          }
        } catch (err) {
          newResults.push({
            testCaseId: tc.id,
            testCaseName: tc.metadata.name,
            jumperName: jumper.name,
            fields: [],
            overallStatus: 'regressed',
            events: null,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    setResults(newResults);
    setAnalyzing(false);
  }, [testCases]);

  // Accept all as new baselines
  const acceptAll = useCallback(async () => {
    setAccepting(true);

    for (const r of results) {
      if (r.error) continue;
      try {
        await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testCaseId: r.testCaseId, jumperName: r.jumperName, accept: true }),
        });
      } catch {
        // continue
      }
    }

    notifications.show({ message: 'All baselines updated', color: 'green' });
    setAccepting(false);

    // Re-analyze to show updated diffs
    await analyzeAll();
  }, [results, analyzeAll]);

  if (loading) return <Center h={400}><Loader size="lg" /></Center>;

  // Group results by status
  const statusOrder: DiffStatus[] = ['regressed', 'lost', 'changed', 'new', 'improved', 'unchanged'];
  const sortedResults = [...results].sort(
    (a, b) => statusOrder.indexOf(a.overallStatus) - statusOrder.indexOf(b.overallStatus)
  );

  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between">
          <div>
            <Group gap="xs" mb="xs">
              <Anchor component={Link} href="/" size="sm" c="dimmed">
                <Group gap={4}><IconArrowLeft size={14} /> Dashboard</Group>
              </Anchor>
            </Group>
            <Title order={2} style={{ color: 'var(--mantine-primary-color-filled)' }}>Analysis Diff Dashboard</Title>
            <Text c="dimmed" size="sm">
              Compare current analysis results against saved baselines
            </Text>
          </div>
          <Group>
            <Button
              leftSection={<IconRefresh size={16} />}
              onClick={analyzeAll}
              loading={analyzing}
            >
              Re-analyze All
            </Button>
            {results.length > 0 && (
              <Button
                leftSection={<IconCheck size={16} />}
                color="green"
                variant="light"
                onClick={acceptAll}
                loading={accepting}
              >
                Accept All
              </Button>
            )}
          </Group>
        </Group>

        {/* Summary badges */}
        {results.length > 0 && (
          <Group gap="xs">
            <SummaryBadge results={results} status="unchanged" label="Stable" />
            <SummaryBadge results={results} status="new" label="New" />
            <SummaryBadge results={results} status="improved" label="Improved" />
            <SummaryBadge results={results} status="changed" label="Changed" />
            <SummaryBadge results={results} status="regressed" label="Regressed" />
          </Group>
        )}

        {results.length === 0 && !analyzing && (
          <Alert icon={<IconAlertCircle size={16} />} color="blue">
            Click &quot;Re-analyze All&quot; to run analysis on all test cases and compare against baselines.
          </Alert>
        )}

        {/* Results Table */}
        {sortedResults.length > 0 && (
          <Card withBorder p="md">
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Test Case</Table.Th>
                  <Table.Th>Jumper</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th>Exit</Table.Th>
                  <Table.Th>Deploy</Table.Th>
                  <Table.Th>Landing</Table.Th>
                  <Table.Th>Changes</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedResults.map((r, idx) => (
                  <Table.Tr key={`${r.testCaseId}-${r.jumperName}-${idx}`}>
                    <Table.Td>
                      <Anchor component={Link} href={`/testcase/${r.testCaseId}`} size="sm">
                        {r.testCaseId}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>
                      <Anchor component={Link} href={`/testcase/${r.testCaseId}/jumper/${r.jumperName}`} size="sm">
                        {r.jumperName}
                      </Anchor>
                    </Table.Td>
                    <Table.Td><StatusBadge status={r.overallStatus} /></Table.Td>
                    <Table.Td>
                      {r.error ? (
                        <Text size="sm" c="red">Error</Text>
                      ) : (
                        <EventCell
                          value={r.events?.exitOffsetSec}
                          field={r.fields.find(f => f.field === 'exitOffsetSec')}
                        />
                      )}
                    </Table.Td>
                    <Table.Td>
                      <EventCell
                        value={r.events?.deploymentOffsetSec}
                        field={r.fields.find(f => f.field === 'deploymentOffsetSec')}
                      />
                    </Table.Td>
                    <Table.Td>
                      <EventCell
                        value={r.events?.landingOffsetSec}
                        field={r.fields.find(f => f.field === 'landingOffsetSec')}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {r.fields.filter(f => f.status !== 'unchanged').length} of {r.fields.length}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
        )}

        {/* Detailed field-level diffs for changed results */}
        {sortedResults
          .filter(r => r.overallStatus !== 'unchanged' && r.fields.length > 0)
          .map((r, idx) => (
            <Card key={`detail-${r.testCaseId}-${r.jumperName}-${idx}`} withBorder p="md">
              <Group mb="sm">
                <Text fw={500}>{r.testCaseId} / {r.jumperName}</Text>
                <StatusBadge status={r.overallStatus} />
              </Group>
              <Table striped>
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
                  {r.fields
                    .filter(f => f.status !== 'unchanged')
                    .map(f => (
                      <Table.Tr key={f.field}>
                        <Table.Td><Text size="sm" fw={500}>{f.field}</Text></Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {f.baselineValue !== null ? formatValue(f.baselineValue) : '\u2014'}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={600}>
                            {f.currentValue !== null ? formatValue(f.currentValue) : '\u2014'}
                          </Text>
                        </Table.Td>
                        <Table.Td><StatusBadge status={f.status} /></Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {f.delta != null ? (f.delta > 0 ? '+' : '') + formatValue(f.delta) : ''}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Card>
          ))}
      </Stack>
    </Container>
  );
}

function StatusBadge({ status }: { status: DiffStatus }) {
  const colors: Record<DiffStatus, string> = {
    unchanged: 'gray',
    improved: 'green',
    regressed: 'red',
    changed: 'yellow',
    new: 'blue',
    lost: 'red',
  };
  return <Badge size="xs" color={colors[status] || 'gray'} variant="light">{status}</Badge>;
}

function SummaryBadge({ results, status, label }: {
  results: JumperResult[]; status: DiffStatus; label: string;
}) {
  const count = results.filter(r => r.overallStatus === status).length;
  if (count === 0) return null;
  const colors: Record<DiffStatus, string> = {
    unchanged: 'gray',
    improved: 'green',
    regressed: 'red',
    changed: 'yellow',
    new: 'blue',
    lost: 'red',
  };
  return (
    <Badge color={colors[status]} variant="light" size="lg">
      {count} {label}
    </Badge>
  );
}

function EventCell({ value, field }: { value: any; field?: FieldDiff }) {
  if (value == null) {
    return <Text size="sm" c="red">null</Text>;
  }

  const color = field?.status === 'new' ? 'green'
    : field?.status === 'lost' ? 'red'
    : field?.status === 'changed' ? 'yellow'
    : undefined;

  return (
    <Text size="sm" c={color} fw={field?.status !== 'unchanged' ? 600 : undefined}>
      {typeof value === 'number' ? `${value.toFixed(1)}s` : String(value)}
    </Text>
  );
}

function formatValue(v: any): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? v.toString() : v.toFixed(2);
  }
  return String(v);
}
