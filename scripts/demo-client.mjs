import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const label = (name) => `\n=== ${name} ===`;

const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/server.js'],
  stderr: 'pipe',
});
const client = new Client({ name: 'demo-client', version: '0.1.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log(label('MIRRORED TOOLS'));
for (const tool of tools.tools) console.log(` - ${tool.name}`);

console.log(label('1. ALLOWED (stdio read)'));
const allowed = await client.callTool({
  name: 'demo__read_file',
  arguments: { path: 'notes.txt' },
});
console.log(' verdict: allowed ->', JSON.stringify(allowed.content));

console.log(label('2. BLOCKED (stdio write)'));
const blocked = await client.callTool({
  name: 'demo__write_file',
  arguments: { path: 'x', contents: 'y' },
});
console.log(' verdict: blocked  ->', JSON.stringify(blocked.content));

console.log(label('3. ALLOWED (streamable HTTP read)'));
const httpAllowed = await client.callTool({
  name: 'demo-http__remote_read',
  arguments: { key: 'k' },
});
console.log(' verdict: allowed ->', JSON.stringify(httpAllowed.content));

console.log(label('4. CONFIRMED (http publish held, then approved by operator)'));
const publishPromise = client
  .callTool({ name: 'demo-http__remote_publish', arguments: { channel: 'c', message: 'm' } })
  .then((r) => {
    console.log(' verdict: confirmed-after-approval ->', JSON.stringify(r.content));
  });

let hold = undefined;
for (let i = 0; i < 40 && !hold; i += 1) {
  await new Promise((r) => setTimeout(r, 250));
  const page = await fetch('http://127.0.0.1:8787/api/holds').then((r) => r.json());
  hold = page.holds[0];
}
if (!hold) throw new Error('no hold appeared');
console.log(` held: rule=${hold.ruleId} tool=${hold.name}`);
const approve = await fetch(`http://127.0.0.1:8787/api/holds/${hold.requestId}/approve`, {
  method: 'POST',
});
console.log(' operator approve:', approve.status);
await publishPromise;

const events = await fetch('http://127.0.0.1:8787/api/events?limit=50').then((r) => r.json());
console.log(label('AUDIT TRAIL (newest first)'));
for (const event of events.events) {
  const detail = event.ruleId ? ` [rule:${event.ruleId}]` : '';
  console.log(` ${event.kind.padEnd(20)} ${(event.name ?? '').padEnd(28)}${detail}`);
}

await client.close();
process.exit(0);
