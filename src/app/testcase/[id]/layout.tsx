// app/testcase/[id]/layout.tsx
//
// Shared shell for a test case: breadcrumb, title, badges, case-wide actions,
// and the routed tab bar. Tabs are navigation, not local state — Overview,
// Formation, and each jumper are real URLs sharing this shell:
//
//   /testcase/[id]                 → Overview tab
//   /testcase/[id]/formation      → Formation tab
//   /testcase/[id]/jumper/[name]  → that jumper's tab
'use client';

import React from 'react';
import { useParams, useRouter, useSelectedLayoutSegments } from 'next/navigation';
import {
  Container, Title, Text, Group, Badge, Stack, Button,
  Loader, Center, Alert, Anchor, Tabs,
} from '@mantine/core';
import {
  IconAlertCircle, IconArrowLeft, IconCheck, IconRefresh,
  IconLayoutDashboard, IconUsers, IconParachute,
} from '@tabler/icons-react';
import Link from 'next/link';
import { TestCaseProvider, useTestCase } from '@/lib/testbed/testcase-context';
import { StatusBadge } from '@/components/testbed/JumperAnalysis';

export default function TestCaseLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const testCaseId = params.id as string;

  return (
    <TestCaseProvider testCaseId={testCaseId}>
      <TestCaseShell>{children}</TestCaseShell>
    </TestCaseProvider>
  );
}

function TestCaseShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segments = useSelectedLayoutSegments();
  const {
    testCaseId, testCase, loading, error,
    analysisResults, anyAnalyzing, analyzeAll, acceptAll,
  } = useTestCase();

  // Active tab from the route: [] → overview; ['formation'] → formation;
  // ['jumper', '<name>'] → that jumper.
  const activeTab =
    segments[0] === 'formation' ? 'formation'
    : segments[0] === 'jumper' && segments[1] ? `jumper:${decodeURIComponent(segments[1])}`
    : 'overview';

  const navigate = (value: string | null) => {
    if (!value || value === activeTab) return;
    const base = `/testcase/${testCaseId}`;
    if (value === 'overview') router.push(base);
    else if (value === 'formation') router.push(`${base}/formation`);
    else if (value.startsWith('jumper:')) {
      router.push(`${base}/jumper/${encodeURIComponent(value.slice('jumper:'.length))}`);
    }
  };

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
            <Title order={2} style={{ color: 'var(--mantine-primary-color-filled)' }}>
              {testCase.metadata.name}
            </Title>
            <Text c="dimmed" size="sm">{testCase.metadata.description}</Text>
          </div>
          <Group>
            <Button
              leftSection={<IconRefresh size={16} />}
              onClick={analyzeAll}
              loading={anyAnalyzing}
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

        {/* Routed tabs — each tab is a URL */}
        <Tabs value={activeTab} onChange={navigate}>
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconLayoutDashboard size={14} />}>
              Overview
            </Tabs.Tab>
            {!testCase.metadata.isSolo && (
              <Tabs.Tab
                value="formation"
                leftSection={<IconUsers size={14} />}
                color="violet"
              >
                Formation
              </Tabs.Tab>
            )}
            {testCase.jumpers.map(j => (
              <Tabs.Tab
                key={j.name}
                value={`jumper:${j.name}`}
                leftSection={<IconParachute size={14} />}
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
        </Tabs>

        {/* Active route content */}
        <div>{children}</div>
      </Stack>
    </Container>
  );
}
