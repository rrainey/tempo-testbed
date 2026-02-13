// app/formation/[id]/page.tsx
'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Container, Title, Text, Group, Stack, Button,
  Loader, Center, Alert, Anchor, Grid
} from '@mantine/core';
import { IconAlertCircle, IconArrowLeft, IconAnalyze } from '@tabler/icons-react';
import Link from 'next/link';
import { FormationViewer } from '@/components/formation/FormationViewer';
import { BaseInfoPanel } from '@/components/formation/BaseInfoPanel';
import { JumperListPanel } from '@/components/formation/JumperListPanel';
import type { FormationData } from '@/components/formation/FormationViewer';
import type { GeodeticCoordinates } from '@/lib/formation/types';

interface FormationApiResponse extends Omit<FormationData, 'startTime'> {
  startTime: string; // ISO string from JSON
  dzCenter: GeodeticCoordinates;
  testCaseName: string;
}

export default function FormationPlaybackPage() {
  const params = useParams();
  const testCaseId = params.id as string;

  const [formation, setFormation] = useState<FormationData | null>(null);
  const [dzCenter, setDzCenter] = useState<GeodeticCoordinates | null>(null);
  const [testCaseName, setTestCaseName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Shared state for synchronizing panels with viewer
  const [currentTime, setCurrentTime] = useState(0);
  const [baseJumperId, setBaseJumperId] = useState('');

  useEffect(() => {
    fetch(`/api/formation/${testCaseId}`)
      .then(r => r.json())
      .then((data: FormationApiResponse & { error?: string }) => {
        if (data.error) throw new Error(data.error);

        // Deserialize: ISO string → Date
        const formationData: FormationData = {
          ...data,
          startTime: new Date(data.startTime),
        };

        setFormation(formationData);
        setDzCenter(data.dzCenter);
        setTestCaseName(data.testCaseName);
        setBaseJumperId(data.baseJumperId);

        // Set initial time to timeline start (10s before first exit) or data start
        if (formationData.timelineStart !== undefined) {
          setCurrentTime(formationData.timelineStart);
        } else {
          const allTimes = formationData.participants.flatMap(p =>
            p.timeSeries.map(ts => ts.timeOffset)
          );
          if (allTimes.length > 0) {
            setCurrentTime(Math.min(...allTimes));
          }
        }

        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [testCaseId]);

  const handleBaseChange = useCallback((newBaseId: string) => {
    setBaseJumperId(newBaseId);
  }, []);

  const handleTimeChange = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  if (loading) {
    return (
      <Center h="100vh">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Loading formation data...</Text>
        </Stack>
      </Center>
    );
  }

  if (error || !formation || !dzCenter) {
    return (
      <Container size="lg" py="xl">
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error || 'Failed to load formation data'}
        </Alert>
        <Button component={Link} href="/" mt="md" variant="light">
          Back to Dashboard
        </Button>
      </Container>
    );
  }

  return (
    <Container size="xl" py="md" style={{ maxWidth: '100%', padding: '0 16px' }}>
      <Stack gap="md">
        {/* Header */}
        <Group justify="space-between">
          <div>
            <Group gap="xs" mb={4}>
              <Anchor component={Link} href="/" size="sm" c="dimmed">
                <Group gap={4}><IconArrowLeft size={14} /> All Tests</Group>
              </Anchor>
              <Text size="sm" c="dimmed">/</Text>
              <Anchor component={Link} href={`/testcase/${testCaseId}`} size="sm" c="dimmed">
                Analysis
              </Anchor>
            </Group>
            <Title order={2} style={{ color: '#ddff55' }}>
              {testCaseName}
            </Title>
            <Text c="dimmed" size="sm">
              Formation Playback — {formation.participants.length} jumpers
            </Text>
          </div>
          <Button
            component={Link}
            href={`/testcase/${testCaseId}`}
            leftSection={<IconAnalyze size={16} />}
            variant="light"
          >
            Open Analysis
          </Button>
        </Group>

        {/* Main content: viewer + side panels */}
        <Grid gutter="md">
          {/* 3D Viewer — takes most of the width */}
          <Grid.Col span={{ base: 12, lg: 9 }}>
            <FormationViewer
              formation={formation}
              dzCenter={dzCenter}
              onBaseChange={handleBaseChange}
              onTimeChange={handleTimeChange}
            />
          </Grid.Col>

          {/* Side panels */}
          <Grid.Col span={{ base: 12, lg: 3 }}>
            <Stack gap="md">
              <BaseInfoPanel
                formation={formation}
                currentTime={currentTime}
                baseJumperId={baseJumperId}
              />
              <JumperListPanel
                formation={formation}
                currentTime={currentTime}
                baseJumperId={baseJumperId}
                dzCenter={dzCenter}
              />
            </Stack>
          </Grid.Col>
        </Grid>
      </Stack>
    </Container>
  );
}
