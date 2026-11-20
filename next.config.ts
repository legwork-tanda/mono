import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't generate AGENTS.md; its guidance lives in CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
