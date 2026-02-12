/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow reading test-data files from server components/API routes
  serverExternalPackages: ['nmea-simple', 'egm96-universal', 'geodesy'],
};

module.exports = nextConfig;
