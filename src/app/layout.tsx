// app/layout.tsx
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider, createTheme, ColorSchemeScript } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tempo Testbed',
  description: 'Analysis algorithm development and testing for Tempo Insights',
};

const theme = createTheme({
  primaryColor: 'yellow',
  colors: {
    // Map theme colors
    dark: [
      '#c5c0c9',  // text foreground
      '#c0d6ea',
      '#99aabb',
      '#778899',
      '#556677',
      '#334455',
      '#11425d',  // secondary bg
      '#002233',  // primary bg
      '#001a29',
      '#001120',
    ],
  },
  fontFamily: undefined,  // use Mantine defaults per-platform
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-mantine-color-scheme="dark">
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="dark">
          <Notifications />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
