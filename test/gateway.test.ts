import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { SpawnOptions } from 'node:child_process';
import { GatewaySupervisor, type GatewayProcess } from '@/electron/gateway';

class FakeProcess extends EventEmitter implements GatewayProcess {
  pid = 4242;
  signals: (NodeJS.Signals | undefined)[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

function createSupervisor(overrides: {
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => GatewayProcess;
  healthCheck?: (url: string) => Promise<boolean>;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
} = {}) {
  const child = new FakeProcess();
  const spawnProcess =
    overrides.spawnProcess ??
    (() => child);
  const healthCheck =
    overrides.healthCheck ??
    (async () => true);
  const supervisor = new GatewaySupervisor({
    serverEntry: '/app/dist/server.js',
    configPath: '/app/warrant.yaml',
    cwd: '/app',
    host: '127.0.0.1',
    port: 8787,
    startupTimeoutMs: overrides.startupTimeoutMs ?? 5_000,
    shutdownTimeoutMs: overrides.shutdownTimeoutMs ?? 3_000,
    spawnProcess,
    healthCheck,
  });
  return { supervisor, child };
}

describe('GatewaySupervisor', () => {
  describe('start', () => {
    it('spawns the server process and waits for health', async () => {
      const child = new FakeProcess();
      let spawnedCommand = '';
      let spawnedArgs: string[] = [];
      const { supervisor } = createSupervisor({
        spawnProcess: (command, args) => {
          spawnedCommand = command;
          spawnedArgs = args;
          return child;
        },
        healthCheck: async () => true,
      });

      await supervisor.start();

      expect(spawnedCommand).toBe(process.execPath);
      expect(spawnedArgs).toEqual(['/app/dist/server.js']);
      expect(supervisor.status).toMatchObject({ state: 'running', pid: 4242 });
    });

    it('transitions through starting → running', async () => {
      const { supervisor } = createSupervisor({
        healthCheck: async () => true,
      });
      const states: string[] = [];
      supervisor.onStatus((s) => states.push(s.state));

      await supervisor.start();

      expect(states).toEqual(['starting', 'running']);
      expect(supervisor.status.state).toBe('running');
    });

    it('emits the admin URL', async () => {
      const { supervisor } = createSupervisor();
      await supervisor.start();
      expect(supervisor.status.url).toBe('http://127.0.0.1:8787');
    });

    it('is a no-op when already running', async () => {
      let spawnCount = 0;
      const { supervisor } = createSupervisor({
        spawnProcess: () => {
          spawnCount++;
          return new FakeProcess();
        },
        healthCheck: async () => true,
      });

      await supervisor.start();
      await supervisor.start();

      expect(spawnCount).toBe(1);
      expect(supervisor.status.state).toBe('running');
    });

    it('rejects when health check never succeeds', async () => {
      const child = new FakeProcess();
      const { supervisor } = createSupervisor({
        spawnProcess: () => child,
        healthCheck: async () => false,
        startupTimeoutMs: 200,
      });

      await expect(supervisor.start()).rejects.toThrow(/did not become healthy|Gateway did not become healthy/);
      expect(supervisor.status.state).toBe('error');
      expect(child.signals).toContain('SIGTERM');
    });

    it('rejects when spawn emits an error', async () => {
      const child = new FakeProcess();
      const { supervisor } = createSupervisor({
        spawnProcess: () => child,
        healthCheck: async () => true,
      });

      const startPromise = supervisor.start();
      child.emit('error', new Error('ENOENT'));
      await expect(startPromise).rejects.toThrow();

      expect(supervisor.status.state).toBe('error');
    });
  });

  describe('stop', () => {
    it('sends SIGTERM to the child process', async () => {
      const child = new FakeProcess();
      const { supervisor } = createSupervisor({
        spawnProcess: () => child,
        healthCheck: async () => true,
      });

      await supervisor.start();
      const stopPromise = supervisor.stop();
      child.emit('exit', 0, null);
      await stopPromise;

      expect(child.signals).toEqual(['SIGTERM']);
      expect(supervisor.status.state).toBe('stopped');
    });

    it('is a no-op when already stopped', async () => {
      const { supervisor } = createSupervisor();
      expect(supervisor.status.state).toBe('stopped');
      await supervisor.stop();
      expect(supervisor.status.state).toBe('stopped');
    });

    it('sends SIGKILL after shutdown timeout', async () => {
      vi.useFakeTimers();
      try {
        const child = new FakeProcess();
        const { supervisor } = createSupervisor({
          spawnProcess: () => child,
          healthCheck: async () => true,
          shutdownTimeoutMs: 500,
        });

        await supervisor.start();
        const stopPromise = supervisor.stop();

        // Advance past the shutdown timeout
        vi.advanceTimersByTime(600);

        // Now emit exit to resolve
        child.emit('exit', null, 'SIGKILL');
        await stopPromise;

        expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
        expect(supervisor.status.state).toBe('stopped');
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles unexpected exit during running state', async () => {
      const child = new FakeProcess();
      const { supervisor } = createSupervisor({
        spawnProcess: () => child,
        healthCheck: async () => true,
      });

      await supervisor.start();
      child.emit('exit', 1, null);

      expect(supervisor.status.state).toBe('error');
      expect(supervisor.status.error).toContain('exited');
    });
  });

  describe('restart', () => {
    it('stops then starts a new child process', async () => {
      const children: FakeProcess[] = [];
      const { supervisor } = createSupervisor({
        spawnProcess: () => {
          const child = new FakeProcess();
          children.push(child);
          return child;
        },
        healthCheck: async () => true,
      });

      await supervisor.start();
      expect(children).toHaveLength(1);

      const restartPromise = supervisor.restart();
      children[0]!.emit('exit', 0, null);
      await restartPromise;

      expect(children).toHaveLength(2);
      expect(supervisor.status.state).toBe('running');
      expect(supervisor.status.pid).toBe(children[1]!.pid);
    });
  });

  describe('status listener', () => {
    it('notifies listeners on state changes', async () => {
      const { supervisor, child } = createSupervisor({
        healthCheck: async () => true,
      });
      const updates: string[] = [];
      supervisor.onStatus((s) => updates.push(s.state));

      await supervisor.start();
      child.emit('exit', 0, null);

      expect(updates).toEqual(['starting', 'running', 'stopped']);
    });

    it('returns an unsubscribe function', async () => {
      const { supervisor } = createSupervisor({
        healthCheck: async () => true,
      });
      const updates: string[] = [];
      const unsub = supervisor.onStatus((s) => updates.push(s.state));

      await supervisor.start();
      unsub();

      expect(typeof unsub).toBe('function');
    });
  });

  describe('health check', () => {
    it('polls the /health endpoint until healthy', async () => {
      let attempts = 0;
      const child = new FakeProcess();
      const { supervisor } = createSupervisor({
        spawnProcess: () => child,
        healthCheck: async () => {
          attempts++;
          return attempts >= 3;
        },
      });

      await supervisor.start();

      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(supervisor.status.state).toBe('running');
    });

    it('passes the correct URL to healthCheck', async () => {
      let checkedUrl = '';
      const { supervisor } = createSupervisor({
        healthCheck: async (url) => {
          checkedUrl = url;
          return true;
        },
      });

      await supervisor.start();

      expect(checkedUrl).toBe('http://127.0.0.1:8787/health');
    });
  });

  describe('concurrent operations', () => {
    it('deduplicates concurrent start calls', async () => {
      let spawnCount = 0;
      const { supervisor } = createSupervisor({
        spawnProcess: () => {
          spawnCount++;
          return new FakeProcess();
        },
        healthCheck: async () => true,
      });

      await Promise.all([supervisor.start(), supervisor.start()]);

      expect(spawnCount).toBe(1);
      expect(supervisor.status.state).toBe('running');
    });

    it('waits for a pending stop before starting', async () => {
      const children: FakeProcess[] = [];
      const { supervisor } = createSupervisor({
        spawnProcess: () => {
          const child = new FakeProcess();
          children.push(child);
          return child;
        },
        healthCheck: async () => true,
      });

      await supervisor.start();
      const stopPromise = supervisor.stop();

      const startPromise = supervisor.restart();
      children[0]!.emit('exit', 0, null);
      await stopPromise;
      await startPromise;

      expect(children).toHaveLength(2);
      expect(supervisor.status.state).toBe('running');
    });
  });

  describe('configuration', () => {
    it('uses custom host and port for URL', async () => {
      const custom = new GatewaySupervisor({
        serverEntry: '/app/dist/server.js',
        host: '0.0.0.0',
        port: 9999,
        spawnProcess: () => new FakeProcess(),
        healthCheck: async () => true,
      });
      expect(custom.status.url).toBe('http://0.0.0.0:9999');
    });

    it('passes WARRANT_CONFIG env to child process', async () => {
      let env: Record<string, string | undefined> = {};
      const { supervisor } = createSupervisor({
        spawnProcess: (_cmd, _args, options) => {
          env = options?.env as Record<string, string | undefined>;
          return new FakeProcess();
        },
        healthCheck: async () => true,
      });

      await supervisor.start();

      expect(env?.WARRANT_CONFIG).toBe('/app/warrant.yaml');
    });
  });
});
