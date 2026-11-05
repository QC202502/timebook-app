import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  distDir: process.env.TIME_LEDGER_BUILD_DIR || '.next',
  reactStrictMode: true
}

export default nextConfig
