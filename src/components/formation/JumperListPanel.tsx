// components/formation/JumperListPanel.tsx
import React, { useMemo } from 'react';
import { Card, Table, Text, Badge, Group, Stack, Title, Divider } from '@mantine/core';
import { IconTrendingUp, IconTrendingDown, IconMinus } from '@tabler/icons-react';
import { projectFormationAtTime, interpolatePosition } from '../../lib/formation/coordinates';
import type { FormationData } from './FormationViewer';
import type { GeodeticCoordinates, Vector3 } from '../../lib/formation/types';

interface JumperMetrics {
  userId: string;
  name: string;
  color: string;
  distanceToBase_ft: number;
  closureRate_fps: number;
  closureRate_mph: number;
  relativeAltitude_ft: number;
  horizontalSeparation_ft: number;
  verticalSpeed_mps: number;
  normalizedFallRate_mph: number;
}

interface JumperListPanelProps {
  formation: FormationData;
  currentTime: number;
  baseJumperId: string;
  dzCenter: GeodeticCoordinates;
}

function calculateVelocityVector(
  participant: any,
  timeOffset: number
): Vector3 {
  // Get velocity from two nearby samples
  const dt = 0.25; // 1/4 second delta
  const t1 = Math.max(0, timeOffset - dt/2);
  const t2 = timeOffset + dt/2;
  
  const pos1 = interpolatePosition(participant.timeSeries, t1);
  const pos2 = interpolatePosition(participant.timeSeries, t2);
  
  return {
    x: (pos2.location.lat_deg - pos1.location.lat_deg) * 111320 / dt, // m/s north
    y: (pos2.location.lon_deg - pos1.location.lon_deg) * 111320 * Math.cos(pos1.location.lat_deg * Math.PI / 180) / dt, // m/s east
    z: -(pos2.location.alt_m - pos1.location.alt_m) / dt // m/s down (positive)
  };
}

function calculateJumperMetrics(
  jumperPos: Vector3,
  basePos: Vector3,
  jumperVel: Vector3,
  baseVel: Vector3,
  jumperData: any
): Partial<JumperMetrics> {
  // Calculate 3D distance
  const dx = jumperPos.x - basePos.x;
  const dy = jumperPos.y - basePos.y;
  const dz = jumperPos.z - basePos.z;
  const distance3D_m = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const horizontalDist_m = Math.sqrt(dx*dx + dy*dy);
  
  // Calculate relative velocity
  const relVel = {
    x: jumperVel.x - baseVel.x,
    y: jumperVel.y - baseVel.y,
    z: jumperVel.z - baseVel.z
  };
  
  // Closure rate (positive = approaching)
  const lineOfSight = distance3D_m > 0 ? {
    x: dx / distance3D_m,
    y: dy / distance3D_m,
    z: dz / distance3D_m
  } : { x: 0, y: 0, z: 0 };
  
  const closureRate_mps = -(relVel.x * lineOfSight.x + 
                            relVel.y * lineOfSight.y + 
                            relVel.z * lineOfSight.z);
  
  return {
    distanceToBase_ft: distance3D_m * 3.28084,
    horizontalSeparation_ft: horizontalDist_m * 3.28084,
    closureRate_fps: closureRate_mps * 3.28084,
    closureRate_mph: closureRate_mps * 2.23694,
    relativeAltitude_ft: -dz * 3.28084, // Negative dz = above base
    verticalSpeed_mps: jumperVel.z,
    normalizedFallRate_mph: jumperData.metrics?.normalizedFallRate_mph || 0
  };
}

export const JumperListPanel: React.FC<JumperListPanelProps> = ({
  formation,
  currentTime,
  baseJumperId,
  dzCenter
}) => {
  const metrics = useMemo(() => {
    try {
      // Get all positions
      const positions = projectFormationAtTime(
        formation.participants,
        currentTime,
        baseJumperId,
        dzCenter
      );

      // Find base participant and position
      const baseParticipant = formation.participants.find(p => p.userId === baseJumperId);
      const basePosition = positions.find(p => p.userId === baseJumperId);
      
      if (!baseParticipant || !basePosition) return [];

      // Calculate base velocity
      const baseVelocity = calculateVelocityVector(baseParticipant, currentTime);

      // Calculate metrics for each jumper
      return positions
        .filter(p => p.userId !== baseJumperId) // Exclude base from list
        .map(jumperPos => {
          const jumperParticipant = formation.participants.find(p => p.userId === jumperPos.userId);
          if (!jumperParticipant) return null;

          const jumperVelocity = calculateVelocityVector(jumperParticipant, currentTime);
          
          const metrics = calculateJumperMetrics(
            jumperPos.position,
            basePosition.position,
            jumperVelocity,
            baseVelocity,
            jumperPos
          );

          return {
            userId: jumperPos.userId,
            name: jumperPos.name,
            color: jumperPos.color,
            ...metrics
          } as JumperMetrics;
        })
        .filter(m => m !== null)
        .sort((a, b) => a.distanceToBase_ft - b.distanceToBase_ft); // Sort by distance
    } catch (error) {
      console.error('Error calculating jumper metrics:', error);
      return [];
    }
  }, [formation, currentTime, baseJumperId, dzCenter]);

  const getClosureRateIcon = (rate: number) => {
    if (rate > 5) return <IconTrendingDown size={16} color="orange" />; // Approaching fast
    if (rate > 0) return <IconTrendingDown size={16} color="green" />;  // Approaching
    if (rate < -5) return <IconTrendingUp size={16} color="red" />;     // Separating fast
    if (rate < 0) return <IconTrendingUp size={16} color="yellow" />;   // Separating
    return <IconMinus size={16} color="gray" />;                        // Stable
  };

  const getRelativeAltColor = (relAlt: number) => {
    if (Math.abs(relAlt) < 10) return 'green';  // Good vertical separation
    if (Math.abs(relAlt) < 20) return 'yellow'; // Marginal
    return 'red'; // Poor vertical separation
  };

  if (metrics.length === 0) {
    return (
      <Card withBorder>
        <Text color="dimmed">No other jumpers in formation</Text>
      </Card>
    );
  }

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Title order={4}>Formation Participants</Title>
        <Divider />
        
        <div style={{ overflowX: 'auto' }}>
          <Table highlightOnHover>
            <thead>
              <tr>
                <th>Jumper</th>
                <th>Distance</th>
                <th>Closure Rate</th>
                <th>Relative Alt</th>
                <th>Fall Rate</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(m => (
                <tr key={m.userId}>
                  <td>
                    <Badge 
                      color={m.color}
                      variant="filled"
                      size="lg"
                    >
                      {m.name}
                    </Badge>
                  </td>
                  <td>
                    <Stack gap={0}>
                      <Text size="sm" fw={500}>
                        {m.distanceToBase_ft.toFixed(0)} ft
                      </Text>
                      <Text size="xs" c="dimmed">
                        H: {m.horizontalSeparation_ft.toFixed(0)} ft
                      </Text>
                    </Stack>
                  </td>
                  <td>
                    <Group gap="xs">
                      {getClosureRateIcon(m.closureRate_fps)}
                      <Stack gap={0}>
                        <Text size="sm">
                          {Math.abs(m.closureRate_fps).toFixed(1)} fps
                        </Text>
                        <Text size="xs" c="dimmed">
                          {Math.abs(m.closureRate_mph).toFixed(0)} mph
                        </Text>
                      </Stack>
                    </Group>
                  </td>
                  <td>
                    <Badge 
                      color={getRelativeAltColor(m.relativeAltitude_ft)}
                      variant="light"
                    >
                      {m.relativeAltitude_ft > 0 ? '+' : ''}
                      {m.relativeAltitude_ft.toFixed(0)} ft
                    </Badge>
                  </td>
                  <td>
                    <Text size="sm">
                      {m.normalizedFallRate_mph.toFixed(0)} mph
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        {/* Summary Statistics */}
        <Divider />
        <Group justify="space-around">
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed">Closest</Text>
            <Text size="sm" fw={500}>
              {Math.min(...metrics.map(m => m.distanceToBase_ft)).toFixed(0)} ft
            </Text>
          </Stack>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed">Furthest</Text>
            <Text size="sm" fw={500}>
              {Math.max(...metrics.map(m => m.distanceToBase_ft)).toFixed(0)} ft
            </Text>
          </Stack>
          <Stack gap="xs" align="center">
            <Text size="xs" c="dimmed">Avg Separation</Text>
            <Text size="sm" fw={500}>
              {(metrics.reduce((sum, m) => sum + m.distanceToBase_ft, 0) / metrics.length).toFixed(0)} ft
            </Text>
          </Stack>
        </Group>
      </Stack>
    </Card>
  );
};