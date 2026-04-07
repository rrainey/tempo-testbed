// app/layout.tsx
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './mantinehub/style.css';
import { ColorSchemeScript } from '@mantine/core';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Tempo Testbed',
  description: 'Analysis algorithm development and testing for Tempo Insights',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-mantine-color-scheme="dark" className={GeistSans.variable}>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
