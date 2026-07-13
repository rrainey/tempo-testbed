// app/testcase/[id]/page.tsx — the Overview tab.
//
// A hub, not a workspace: one card for the formation view (when the case is a
// formation) and one card per jumper with headline numbers from the stored
// baseline. All analysis lives on the per-jumper routes.
'use client';

import React from 'react';
import Link from 'next/link';
import {
  Card, Group, Badge, Text, SimpleGrid, Stack, Alert,
} from '@mantine/core';
import {
  IconParachute, IconUsers, IconChevronRight, IconAlertCircle,
} from '@tabler/icons-react';
import { useTestCase } from '@/lib/testbed/testcase-context';

function fmtSec(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)}s` : '—';
}

export default function TestCaseOverviewPage() {
  const { testCaseId, testCase } = useTestCase();
  if (!testCase) return null; // layout handles loading/error

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
      {!testCase.metadata.isSolo && (
        <Card
          withBorder p="lg" radius="md"
          component={Link}
          href={`/testcase/${testCaseId}/formation`}
          style={{ borderColor: 'var(--mantine-color-violet-filled)' }}
        >
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap={8}>
                <IconUsers size={20} style={{ color: '#855bf0' }} />
                <Text fw={600} style={{ color: '#b79bff' }}>Formation</Text>
              </Group>
              <Badge color="violet" variant="light">
                {testCase.metadata.jumpers.length}-way
              </Badge>
            </Group>
            <Text size="sm" c="dimmed">
              Base: {testCase.metadata.baseJumper || '—'}
            </Text>
            <Group gap={4} c="violet" mt={4}>
              <Text size="sm">Open formation view</Text>
              <IconChevronRight size={14} />
            </Group>
          </Stack>
        </Card>
      )}

      {testCase.jumpers.map(j => (
        <Card
          key={j.name}
          withBorder p="lg" radius="md"
          component={Link}
          href={`/testcase/${testCaseId}/jumper/${encodeURIComponent(j.name)}`}
        >
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap={8}>
                <IconParachute size={20} style={{ color: 'var(--mantine-primary-color-filled)' }} />
                <Text fw={600}>{j.name}</Text>
              </Group>
              {j.baseline?.analyzedAt
                ? <Badge color="green" variant="light">baseline ✓</Badge>
                : <Badge color="gray" variant="light">no baseline</Badge>}
            </Group>
            {j.hasFlightData ? (
              j.baseline?.events ? (
                <Group gap="md">
                  <Text size="xs" c="dimmed">exit {fmtSec(j.baseline.events.exitOffsetSec)}</Text>
                  <Text size="xs" c="dimmed">deploy {fmtSec(j.baseline.events.deploymentOffsetSec)}</Text>
                  <Text size="xs" c="dimmed">land {fmtSec(j.baseline.events.landingOffsetSec)}</Text>
                </Group>
              ) : (
                <Text size="xs" c="dimmed">not yet analyzed</Text>
              )
            ) : (
              <Alert color="yellow" p={6} icon={<IconAlertCircle size={14} />}>
                <Text size="xs">no flight.txt</Text>
              </Alert>
            )}
            <Group gap={4} c="var(--mantine-primary-color-filled)" mt={4}>
              <Text size="sm">Open analysis</Text>
              <IconChevronRight size={14} />
            </Group>
          </Stack>
        </Card>
      ))}
    </SimpleGrid>
  );
}
