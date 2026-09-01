import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { GatewaySupervisor, type GatewayProcess } from '@/electron/gateway';

class FakeProcess extends EventEmitter implements GatewayProcess {
  pid = 4242;
  signals: (NodeJS.Signals | undefined)[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

describe('GatewaySupervisor', () => {
  it('starts the gateway, waits for health, and tracks process exits', async () => {
    const child = new FakeProcess();
    let command = '';
    let args: string[] = [];
    const statuses: string[] = [];
    const supervisor = new GatewaySupervisor({
      serverEntry: '/app/dist/server.js',
      configPath: '/app/warrant.yaml',
      spawnProcess: (spawnCommand, spawnArgs) => {
        command = spawnCommand;
        args = spawnArgs;
        return child;
      },
      healthCheck: async () => true,
    });
    supervisor.onStatus((status) => statuses.push(status.state));

    await supervisor.start();

    expect(command).toBe(process.execPath);
    expect(args).toEqual(['/app/dist/server.js']);
    expect(supervisor.status).toMatchObject({ state: 'running', pid: 4242 });
    expect(statuses).toEqual(['starting', 'running']);

    child.emit('exit', 0, null);
    expect(supervisor.status).toMatchObject({ state: 'stopped' });
  });

  it('stops and restarts an active gateway process', async () => {
    const children: FakeProcess[] = [];
    const supervisor = new GatewaySupervisor({
      serverEntry: '/app/dist/server.js',
      spawnProcess: () => {
        const child = new FakeProcess();
        children.push(child);
        return child;
      },
      healthCheck: async () => true,
    });

    await supervisor.start();
    const firstStop = supervisor.stop();
    children[0]!.emit('exit', 0, null);
    await firstStop;
    expect(children[0]!.signals).toEqual(['SIGTERM']);
    expect(supervisor.status.state).toBe('stopped');

    await supervisor.restart();
    expect(children).toHaveLength(2);
    expect(supervisor.status.state).toBe('running');
  });
});
