import { spawn, type SpawnOptions } from 'node:child_process';

export type GatewayState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export type GatewayStatus = {
  state: GatewayState;
  url: string;
  pid?: number;
  error?: string;
};

export type GatewayProcess = {
  pid?: number;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'error' | 'exit', listener: (...args: unknown[]) => void): unknown;
};

export type GatewaySupervisorOptions = {
  serverEntry: string;
  configPath?: string;
  cwd?: string;
  host?: string;
  port?: number;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => GatewayProcess;
  healthCheck?: (url: string) => Promise<boolean>;
};

type StatusListener = (status: GatewayStatus) => void;

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;

export class GatewaySupervisor {
  private readonly options: Required<
    Pick<
      GatewaySupervisorOptions,
      'host' | 'port' | 'startupTimeoutMs' | 'shutdownTimeoutMs' | 'spawnProcess' | 'healthCheck'
    >
  > &
    Pick<GatewaySupervisorOptions, 'configPath' | 'serverEntry' | 'cwd'>;
  private readonly listeners = new Set<StatusListener>();
  private child?: GatewayProcess;
  private startPromise?: Promise<void>;
  private stopPromise?: Promise<void>;
  private currentStatus: GatewayStatus;

  constructor(options: GatewaySupervisorOptions) {
    this.options = {
      ...options,
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
      startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      shutdownTimeoutMs: options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      spawnProcess:
        options.spawnProcess ??
        ((command, args, spawnOptions) => spawn(command, args, spawnOptions)),
      healthCheck: options.healthCheck ?? checkHealth,
    };
    this.currentStatus = { state: 'stopped', url: this.url };
  }

  get url(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }

  get configPath(): string | undefined {
    return this.options.configPath;
  }

  get status(): GatewayStatus {
    return { ...this.currentStatus };
  }

  setConfigPath(path: string): void {
    this.options.configPath = path;
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.currentStatus.state === 'running') return;
    if (this.currentStatus.state === 'starting' && this.startPromise) return this.startPromise;
    if (this.currentStatus.state === 'stopping' && this.stopPromise) await this.stopPromise;

    this.setStatus({ state: 'starting', url: this.url });
    const child = this.options.spawnProcess(process.execPath, [this.options.serverEntry], {
      cwd: this.options.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...(this.options.configPath ? { WARRANT_CONFIG: this.options.configPath } : {}),
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    let spawnError: string | undefined;
    child.once('error', (error) => {
      if (this.child !== child) return;
      spawnError = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: 'error', url: this.url, error: spawnError });
    });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      if (this.currentStatus.state === 'stopping' || code === 0) {
        this.setStatus({ state: 'stopped', url: this.url });
      } else {
        this.setStatus({
          state: 'error',
          url: this.url,
          error: `Gateway exited${signal ? ` with ${signal}` : ` with code ${code ?? 'unknown'}`}`,
        });
      }
    });

    this.startPromise = this.waitUntilHealthy(child, () => spawnError).then(
      () => {
        if (spawnError) throw new Error(spawnError);
        if (this.child === child && this.currentStatus.state === 'starting') {
          this.setStatus({ state: 'running', url: this.url, pid: child.pid });
        }
      },
      async (error: unknown) => {
        if (this.child === child) {
          child.kill('SIGTERM');
          this.child = undefined;
        }
        const message = spawnError ?? (error instanceof Error ? error.message : String(error));
        this.setStatus({ state: 'error', url: this.url, error: message });
        throw new Error(message);
      },
    );
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    if (!this.child) {
      if (this.currentStatus.state !== 'stopped')
        this.setStatus({ state: 'stopped', url: this.url });
      return;
    }
    if (this.currentStatus.state === 'stopping' && this.stopPromise) return this.stopPromise;

    const child = this.child;
    this.setStatus({ state: 'stopping', url: this.url, pid: child.pid });
    this.stopPromise = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (this.child === child) this.child = undefined;
        this.setStatus({ state: 'stopped', url: this.url });
        resolve();
      };
      child.once('exit', finish);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
        finish();
      }, this.options.shutdownTimeoutMs);
    });
    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = undefined;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async restartWithConfig(configPath: string): Promise<void> {
    this.setConfigPath(configPath);
    await this.restart();
  }

  private async waitUntilHealthy(
    child: GatewayProcess,
    getSpawnError: () => string | undefined,
  ): Promise<void> {
    const startedAt = Date.now();
    let lastError = 'Gateway did not become healthy';
    while (this.child === child && Date.now() - startedAt < this.options.startupTimeoutMs) {
      const se = getSpawnError();
      if (se) throw new Error(se);
      try {
        if (await this.options.healthCheck(`${this.url}/health`)) return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(lastError);
  }

  private setStatus(status: GatewayStatus): void {
    this.currentStatus = status;
    for (const listener of this.listeners) listener(this.status);
  }
}

async function checkHealth(url: string): Promise<boolean> {
  const response = await fetch(url);
  return response.ok;
}
