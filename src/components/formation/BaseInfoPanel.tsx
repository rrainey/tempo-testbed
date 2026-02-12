// components/formation/BaseInfoPanel.tsx
import React from 'react';
import { Card, Stack, Text, Title, Badge, Group, Divider } from '@mantine/core';
import { IconArrowDown, IconWindmill, IconMountain } from '@tabler/icons-react';
import { interpolatePosition } from '../../lib/formation/coordinates';
import type { FormationData } from './FormationViewer';

interface BaseInfoPanelProps {
  formation: FormationData;
  currentTime: number;
  baseJumperId: string;
}

export const BaseInfoPanel: React.FC<BaseInfoPanelProps> = ({
  formation,
  currentTime,
  baseJumperId
}) => {
  const baseParticipant = formation.participants.find(p => p.userId === baseJumperId);
  
  if (!baseParticipant) {
    return (
      <Card withBorder>
        <Text color="dimmed">No base jumper selected</Text>
      </Card>
    );
  }

  // Get interpolated metrics at current time
  const currentMetrics = interpolatePosition(baseParticipant.timeSeries, currentTime);
  
  // Calculate AGL if DZ elevation available
  const altitudeAGL = formation.dzElevation_m 
    ? (currentMetrics.location.alt_m - formation.dzElevation_m) * 3.28084
    : null;

  // Format fall rate with color coding
  const getFallRateColor = (rate: number) => {
    if (rate < 110) return 'green';
    if (rate > 130) return 'red';
    return 'yellow';
  };

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={4}>Base Jumper</Title>
          <Badge size="lg" color="blue">{baseParticipant.name}</Badge>
        </Group>
        
        <Divider />
        
        {/* Fall Rate Section */}
        <Stack gap="xs">
          <Group gap="xs">
            <IconArrowDown size={18} />
            <Text size="sm" fw={500}>Fall Rate</Text>
          </Group>
          
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Actual:</Text>
            <Text size="sm" fw={500}>
              {((currentMetrics.verticalSpeed_mps ?? 0) * 2.23694).toFixed(1)} mph
            </Text>
          </Group>
          
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Normalized:</Text>
            <Badge 
              color={getFallRateColor(currentMetrics.normalizedFallRate_mph || 0)}
              size="lg"
            >
              {(currentMetrics.normalizedFallRate_mph || 0).toFixed(1)} mph
            </Badge>
          </Group>
        </Stack>

        <Divider />

        {/* Altitude Section */}
        <Stack gap="xs">
          <Group gap="xs">
            <IconMountain size={18} />
            <Text size="sm" fw={500}>Altitude</Text>
          </Group>
          
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Barometric:</Text>
            <Text size="sm" fw={500}>
              {currentMetrics.baroAlt_ft ? currentMetrics.baroAlt_ft.toFixed(0) : '---'} ft MSL
            </Text>
          </Group>
          
          {altitudeAGL && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">AGL:</Text>
              <Text size="sm" fw={500}>
                {altitudeAGL.toFixed(0)} ft
              </Text>
            </Group>
          )}
        </Stack>

        <Divider />

        {/* Ground Track Section */}
        <Stack gap="xs">
          <Group gap="xs">
            <IconWindmill size={18} />
            <Text size="sm" fw={500}>Ground Track</Text>
          </Group>
          
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Heading:</Text>
            <Text size="sm" fw={500}>
              {(currentMetrics.groundtrack_degT || 0).toFixed(0)}°
            </Text>
          </Group>
          
          <Group justify="space-between">
            <Text size="sm" c="dimmed">Speed:</Text>
            <Text size="sm" fw={500}>
              {((currentMetrics.groundspeed_kmph || 0) * 0.621371).toFixed(1)} mph
            </Text>
          </Group>
        </Stack>

        {/* Data Quality Indicator */}
        {currentMetrics.isInterpolated && (
          <>
            <Divider />
            <Text size="xs" c="yellow" ta="center">
              ⚠️ Interpolated Data
            </Text>
          </>
        )}
      </Stack>
    </Card>
  );
};