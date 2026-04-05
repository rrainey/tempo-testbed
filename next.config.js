const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow reading test-data files from server components/API routes
  serverExternalPackages: ['nmea-simple', 'egm96-universal', 'geodesy'],

  // Transpile @tempo/core so Next.js processes its TypeScript source directly
  transpilePackages: ['@tempo/core'],

  webpack: (config) => {
    // Ensure packages imported by @tempo/core resolve from THIS project's
    // node_modules, not from tempo-core's (which doesn't install peer deps).
    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      'node_modules',
    ];
    return config;
  },
};

module.exports = nextConfig;
