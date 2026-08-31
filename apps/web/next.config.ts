import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  reactStrictMode: true,
  async rewrites() {
    const agentBackend = process.env.AGENT_BACKEND_URL;
    if (!agentBackend) return [];
    return [
      { source: "/api/get_config", destination: `${agentBackend}/get_config` },
      { source: "/api/startAgent", destination: `${agentBackend}/startAgent` },
      { source: "/api/stopAgent", destination: `${agentBackend}/stopAgent` },
    ];
  },
};

export default nextConfig;
