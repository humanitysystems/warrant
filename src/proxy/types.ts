import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export type RegisteredTool = Tool & {
  exposedName: string;
  serverName: string;
  downstreamName: string;
};

export type ServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type ServerSnapshot = {
  name: string;
  transport: 'stdio' | 'http';
  status: ServerStatus;
  tools: RegisteredTool[];
  connectedAt?: string;
  lastError?: string;
};
