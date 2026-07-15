// components/testbed/LogbookSummary.tsx
//
// The jump the way a jumper would write it in their logbook: date and exit
// time in the drop zone's local timezone, location, exit and deployment
// altitudes (ft AGL, nearest 10), and freefall time (whole seconds).
'use client';

import React from 'react';
import { Card, Group, Text, SimpleGrid } from '@mantine/core';
import { IconNotebook } from '@tabler/icons-react';

interface DropzoneInfo {
  name: string;
  timezone?: string;
}

interface LogbookSummaryProps {
  events: any; // JumpEvents from the analysis result (log-time offsets)
  dropzone?: DropzoneInfo;
}

function roundTo10(feet: number): string {
  return `${(Math.round(feet / 10) * 10).toLocaleString()} ft`;
}

export function LogbookSummary({ events, dropzone }: LogbookSummaryProps) {
  const exitUTC = events?.exitTimestampUTC ? new Date(events.exitTimestampUTC) : null;
  const tz = dropzone?.timezone; // undefined → formatter falls back to browser TZ

  let dateStr = '—';
  let timeStr = '—';
  if (exitUTC && !Number.isNaN(exitUTC.getTime())) {
    try {
      dateStr = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      }).format(exitUTC);
      timeStr = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      }).format(exitUTC);
    } catch {
      // invalid IANA zone string in metadata — fall back to UTC display
      dateStr = exitUTC.toISOString().slice(0, 10);
      timeStr = `${exitUTC.toISOString().slice(11, 16)} UTC`;
    }
  }

  const freefallStr =
    events?.exitOffsetSec != null && events?.deploymentOffsetSec != null
      ? `${Math.round(events.deploymentOffsetSec - events.exitOffsetSec)} s`
      : '—';

  const blocks: { label: string; value: string }[] = [
    { label: 'Date', value: dateStr },
    { label: 'Exit Time', value: timeStr },
    { label: 'Location', value: dropzone?.name ?? '—' },
    { label: 'Exit Altitude', value: events?.exitAltitudeFt != null ? roundTo10(events.exitAltitudeFt) : '—' },
    { label: 'Freefall Time', value: freefallStr },
    { label: 'Deployment Altitude', value: events?.deployAltitudeFt != null ? roundTo10(events.deployAltitudeFt) : '—' },
  ];

  return (
    <Card withBorder p="md" data-testid="logbook-summary">
      <Group gap={8} mb="sm">
        <IconNotebook size={18} style={{ color: 'var(--mantine-primary-color-filled)' }} />
        <Text fw={600}>Logbook</Text>
        <Text size="xs" c="dimmed">altitudes AGL · times local to the DZ</Text>
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }} spacing="md">
        {blocks.map(b => (
          <div key={b.label}>
            <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: '0.04em' }}>
              {b.label}
            </Text>
            <Text fw={600}>{b.value}</Text>
          </div>
        ))}
      </SimpleGrid>
    </Card>
  );
}
