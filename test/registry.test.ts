import { describe, expect, it } from 'vitest';
import { Registry } from '../src/proxy/registry.js';

describe('Registry', () => {
  it('tracks server state and namespaced tools', () => {
    const registry = new Registry();
    registry.register('files');
    registry.setTools('files', [{
      name: 'read_file',
      exposedName: 'files__read_file',
      downstreamName: 'read_file',
      serverName: 'files',
      inputSchema: { type: 'object' },
    }]);
    registry.setStatus('files', 'connected');

    expect(registry.findTool('files__read_file')?.downstreamName).toBe('read_file');
    expect(registry.serversList()[0]?.status).toBe('connected');
    expect(() => registry.register('files')).toThrow('Duplicate downstream server');
  });
});
