'use client';

import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { shadcnTheme } from './mantinehub/theme';
import { shadcnCssVariableResolver } from './mantinehub/cssVariableResolver';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider
      theme={shadcnTheme}
      defaultColorScheme="dark"
      cssVariablesResolver={shadcnCssVariableResolver}
    >
      <Notifications />
      {children}
    </MantineProvider>
  );
}
