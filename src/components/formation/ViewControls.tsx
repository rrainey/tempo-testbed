// components/formation/ViewControls.tsx
import React from 'react';
import { Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { IconEye, IconArrowsHorizontal, IconFocus } from '@tabler/icons-react';

export interface ViewConfiguration {
  name: string;
  description: string;
  icon: React.ReactNode;
  axes: { x: string; y: string; z: string };
  cameraPosition: { x: number; y: number; z: number };
  cameraTarget: { x: number; y: number; z: number };
  gridRotation: { x: number; y: number; z: number };
  labels: {
    x: string;
    y: string;
    z: string;
  };
  scale: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
}

export const VIEW_CONFIGURATIONS: Record<string, ViewConfiguration> = {
  godsEye: {
    name: "God's Eye View",
    description: "Looking down from above",
    icon: <IconEye size={18} />,
    axes: { x: 'x', y: 'y', z: '-z' }, // Base Exit Frame axes
    cameraPosition: { x: 0, y: -150, z: 150 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    gridRotation: { x: Math.PI / 2, y: 0, z: 0 },
    labels: {
      x: 'Forward (ft)', // Along base jumper's ground track
      y: 'Right (ft)',
      z: 'Up (ft)'
    },
    scale: {
      x: [-100, 100], // meters, will convert to feet for display
      y: [-100, 100],
      z: [-50, 50]
    }
  },
  side: {
    name: "Side View",
    description: "Looking from the side (perpendicular to jump run)",
    icon: <IconArrowsHorizontal size={18} />,
    axes: { x: 'x', y: '-z', z: 'y' }, // Forward and Up
    cameraPosition: { x: 0, y: 0, z: 200 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    gridRotation: { x: 0, y: 0, z: 0 },
    labels: {
      x: 'Forward (ft)',
      y: 'Altitude Difference (ft)',
      z: 'Right (ft)'
    },
    scale: {
      x: [-100, 100],
      y: [-50, 50], // Smaller vertical range
      z: [-100, 100]
    }
  },
  trailing: {
    name: "Trailing View", 
    description: "Looking forward along jump run",
    icon: <IconFocus size={18} />,
    axes: { x: 'y', y: '-z', z: '-x' }, // Right and Up
    cameraPosition: { x: -150, y: 0, z: 50 },
    cameraTarget: { x: 0, y: 0, z: 0 },
    gridRotation: { x: 0, y: Math.PI / 2, z: 0 },
    labels: {
      x: 'Right (ft)',
      y: 'Altitude Difference (ft)', 
      z: 'Behind (ft)'
    },
    scale: {
      x: [-100, 100],
      y: [-50, 50],
      z: [-100, 100]
    }
  }
};

interface ViewControlsProps {
  currentView: string;
  onViewChange: (viewKey: string) => void;
}

export const ViewControls: React.FC<ViewControlsProps> = ({ currentView, onViewChange }) => {
  return (
    <Paper p="xs" withBorder>
      <Stack gap="xs">
        <Text size="sm" fw={500}>Camera View</Text>
        <Group gap="xs">
          {Object.entries(VIEW_CONFIGURATIONS).map(([key, config]) => (
            <Tooltip key={key} label={config.description} position="top">
              <Button
                variant={currentView === key ? 'filled' : 'outline'}
                size="sm"
                leftSection={config.icon}
                onClick={() => onViewChange(key)}
                style={
                  currentView === key
                    ? {
                        backgroundColor: '#228be6', // theme.colors.blue[6]
                        color: 'white',
                        borderColor: '#228be6',
                      }
                    : undefined
                }
              >
                {config.name}
              </Button>
            </Tooltip>
          ))}
        </Group>
      </Stack>
    </Paper>
  );
};