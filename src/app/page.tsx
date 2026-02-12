// app/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import {
  Container, Title, Text, Card, Group, Badge, Stack,
  SimpleGrid, Button, Loader, Center, Alert, Anchor
} from '@mantine/core';
import {
  IconParachute, IconUsers, IconCheck, IconAlertCircle,
  IconPlayerPlay, IconFolder
} from '@tabler/icons-react';
import Link from 'next/link';

interface TestCaseSummary {
  id: string;
  metadata: {
    name: string;
    description: string;
    jumpers: string[];
    isSolo: boolean;
    tags: string[];
    dropzone: { name: string };
  };
  jumperCount: number;
  hasBaseline: boolean;
}

export default function DashboardPage() {
  const [testCases, setTestCases] = useState<TestCaseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/testcases')
      .then(r => r.json())
      .then(data => {
        setTestCases(data.testCases || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={1} mb="xs" style={{ color: '#ddff55' }}>
            Tempo Testbed
          </Title>
          <Text c="dimmed" size="lg">
            Analysis algorithm development and regression testing
          </Text>
        </div>

        {loading && (
          <Center h={200}><Loader size="lg" /></Center>
        )}

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!loading && testCases.length === 0 && (
          <Alert icon={<IconFolder size={16} />} color="yellow" title="No test cases found">
            <Text size="sm">
              Add test cases to the <code>test-data/</code> directory. Each test case needs
              a <code>metadata.json</code> file and one or more jumper subdirectories
              containing <code>flight.txt</code> files.
            </Text>
          </Alert>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
          {testCases.map(tc => (
            <Card key={tc.id} withBorder p="lg" radius="md"
              component={Link} href={`/testcase/${tc.id}`}
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              <Group justify="space-between" mb="md">
                <Group gap="xs">
                  {tc.metadata.isSolo
                    ? <IconParachute size={20} style={{ color: '#ddff55' }} />
                    : <IconUsers size={20} style={{ color: '#855bf0' }} />
                  }
                  <Text fw={600}>{tc.metadata.name}</Text>
                </Group>
                {tc.hasBaseline
                  ? <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>
                      Baseline
                    </Badge>
                  : <Badge color="gray" variant="light">No baseline</Badge>
                }
              </Group>

              <Text size="sm" c="dimmed" mb="md" lineClamp={2}>
                {tc.metadata.description}
              </Text>

              <Group gap="xs" wrap="wrap">
                <Badge size="xs" variant="outline">{tc.metadata.dropzone.name}</Badge>
                <Badge size="xs" variant="outline">
                  {tc.jumperCount} jumper{tc.jumperCount !== 1 ? 's' : ''}
                </Badge>
                {tc.metadata.tags.slice(0, 3).map(tag => (
                  <Badge key={tag} size="xs" variant="dot" color="gray">{tag}</Badge>
                ))}
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      </Stack>
    </Container>
  );
}
