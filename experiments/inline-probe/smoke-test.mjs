import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Script } from 'node:vm';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const server = spawn(fileURLToPath(new URL('./launch.sh', import.meta.url)), [], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let sequence = 0;
let stderr = '';
server.stderr.setEncoding('utf8');
server.stderr.on('data', chunk => { stderr += chunk; });
const lines = createInterface({ input: server.stdout });
lines.on('line', line => {
  const message = JSON.parse(line); // Any non-protocol stdout fails this smoke test.
  assert.equal(message.jsonrpc, '2.0');
  const handler = pending.get(message.id);
  if (handler) {
    pending.delete(message.id);
    clearTimeout(handler.timeout);
    handler.resolve(message);
  }
});
function request(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out: ' + method)), 4000);
    pending.set(id, { resolve, timeout });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

try {
  const initialization = await request('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'arco-protocol-smoke', version: '0.0.1' },
    capabilities: { experimental: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
  });
  assert.equal(initialization.result?.protocolVersion, '2025-11-25');
  assert.equal(initialization.result.serverInfo.name, 'arco-inline-probe');
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const listedTools = (await request('tools/list')).result.tools;
  assert.deepEqual(listedTools.map(tool => tool.name), ['render_inline_probe', 'render_inline_probe_compat']);
  const uri = listedTools[0]._meta.ui.resourceUri;
  assert.equal(listedTools[1]._meta['openai/outputTemplate'], uri);
  for (const tool of listedTools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.equal(tool._meta['openai/ui']?.entrypoints, undefined);
  }

  let token;
  for (const tool of listedTools) {
    const called = await request('tools/call', { name: tool.name, arguments: {} });
    assert.equal(called.result.structuredContent.marker, 'ARCO INLINE PROBE');
    assert.equal(called.result.structuredContent.issue, 'yu/Arco #42');
    assert.match(called.result.structuredContent.serverToken, /^ARCO-[a-f0-9-]{36}$/);
    token = called.result.structuredContent.serverToken;
    assert.equal(JSON.parse(called.result.content[0].text).serverToken, token);
  }

  const resources = (await request('resources/list')).result.resources;
  assert.equal(resources[0].uri, uri);
  const resource = (await request('resources/read', { uri })).result.contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource._meta['openai/ui'].availableDisplayModes, ['inline']);
  assert.equal(resource._meta['openai/ui'].preferredDisplayMode, 'inline');
  assert.ok(resource.text.includes(token));
  assert.ok(resource.text.includes('ARCO INLINE PROBE'));
  assert.ok(resource.text.includes('Local counter: 0'));
  assert.ok(resource.text.includes('ui/initialize'));
  assert.equal(resource.text.includes('__SERVER_TOKEN__'), false);
  for (const match of resource.text.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(match[1]);
  assert.equal((await request('ping')).error, undefined);
  assert.equal((await request('tools/call', { name: 'missing', arguments: {} })).error.code, -32602);

  const exit = once(server, 'exit');
  server.stdin.end();
  const [code] = await exit;
  assert.equal(code, 0);
  assert.ok(stderr.includes('[arco-inline-probe] resources/read ' + uri));
  assert.ok(stderr.trim().split('\n').every(line => line.startsWith('[arco-inline-probe] ')));
  console.log('PASS: initialize → tools/list → both tools/call → resources/list/read → clean shutdown');
  console.log('PASS: read-only metadata, no entrypoints, inline-only resource, matching unique token, HTML script syntax');
  console.log('NOT TESTED: Codex installation, actual inline placement, iframe bridge, and button interaction');
} finally {
  for (const handler of pending.values()) clearTimeout(handler.timeout);
  if (server.exitCode === null) server.kill();
}
