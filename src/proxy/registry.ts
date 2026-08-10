import type { RegisteredTool, ServerSnapshot, ServerStatus } from '@/proxy/types';

type MutableServer = ServerSnapshot;

export class Registry {
  private readonly servers = new Map<string, MutableServer>();

  register(name: string): void {
    if (this.servers.has(name)) throw new Error(`Duplicate downstream server: ${name}`);
    this.servers.set(name, { name, transport: 'stdio', status: 'connecting', tools: [] });
  }

  setStatus(name: string, status: ServerStatus, error?: string): void {
    const server = this.require(name);
    server.status = status;
    server.lastError = error;
    if (status === 'connected') server.connectedAt = new Date().toISOString();
  }

  setTools(name: string, tools: RegisteredTool[]): void {
    this.require(name).tools = tools;
  }

  serversList(): ServerSnapshot[] {
    return [...this.servers.values()].map((server) => ({ ...server, tools: [...server.tools] }));
  }

  toolsList(): RegisteredTool[] {
    return this.serversList().flatMap((server) => server.tools);
  }

  findTool(exposedName: string): RegisteredTool | undefined {
    return this.toolsList().find((tool) => tool.exposedName === exposedName);
  }

  private require(name: string): MutableServer {
    const server = this.servers.get(name);
    if (!server) throw new Error(`Unknown downstream server: ${name}`);
    return server;
  }
}
