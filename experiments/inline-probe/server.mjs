import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const protocolVersions = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const resourceUri = 'ui://arco-inline-probe/card.html';
const mimeType = 'text/html;profile=mcp-app';
const serverToken = 'ARCO-' + randomUUID();
const html = readFileSync(new URL('./card.html', import.meta.url), 'utf8')
  .replaceAll('__SERVER_TOKEN__', serverToken);
let initialized = false;

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const inputSchema = { type: 'object', properties: {}, additionalProperties: false };
const tools = [
  {
    name: 'render_inline_probe',
    title: 'Arco Inline Probe — standard metadata',
    description: 'Render the ARCO INLINE PROBE card inside the conversation. This is a fixed local sample, with no network or GitHub access. Do not open a sidebar or fullscreen view instead.',
    inputSchema,
    annotations,
    _meta: { ui: { resourceUri } },
  },
  {
    name: 'render_inline_probe_compat',
    title: 'Arco Inline Probe — compatibility metadata',
    description: 'Compare legacy openai/outputTemplate linkage with the standard inline probe. This uses the same read-only HTML resource and does not declare an entrypoint.',
    inputSchema,
    annotations,
    _meta: { 'openai/outputTemplate': resourceUri },
  },
];

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function fail(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function dispatch(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)
      || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    // Replies from a client are not requests and need no response.
    if (message?.jsonrpc === '2.0' && ('result' in message || 'error' in message)) return;
    fail(null, -32600, 'Invalid JSON-RPC request');
    return;
  }
  const hasId = Object.hasOwn(message, 'id');
  if (!hasId) return; // Includes notifications/initialized and notifications/cancelled.
  const { id, method, params = {} } = message;
  if (typeof id !== 'string' && typeof id !== 'number') {
    fail(null, -32600, 'Request id must be a string or number');
    return;
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    fail(id, -32602, 'Params must be an object');
    return;
  }
  // Trace only known protocol names, never arguments or arbitrary client input.
  const knownMethods = ['initialize', 'ping', 'tools/list', 'tools/call', 'resources/list', 'resources/templates/list', 'resources/read'];
  let trace = knownMethods.includes(method) ? method : '[unknown method]';
  if (method === 'tools/call') trace += ' ' + (tools.some(tool => tool.name === params.name) ? params.name : '[unknown tool]');
  if (method === 'resources/read') trace += ' ' + (params.uri === resourceUri ? resourceUri : '[unknown resource]');
  process.stderr.write('[arco-inline-probe] ' + trace + '\n');
  if (method === 'ping') {
    reply(id, {});
    return;
  }
  if (method === 'initialize') {
    if (typeof params.protocolVersion !== 'string' || !params.clientInfo || !params.capabilities) {
      fail(id, -32602, 'Initialize requires protocolVersion, capabilities, and clientInfo');
      return;
    }
    initialized = true;
    reply(id, {
      protocolVersion: protocolVersions.has(params.protocolVersion) ? params.protocolVersion : '2025-11-25',
      serverInfo: { name: 'arco-inline-probe', title: 'Arco Inline Probe', version: '0.0.2' },
      capabilities: {
        tools: {},
        resources: {},
        experimental: { 'io.modelcontextprotocol/ui': { mimeTypes: [mimeType] } },
      },
      instructions: 'This server is an inline rendering experiment. Call render_inline_probe first. A text tool result, plugin installation, or a side panel alone is not evidence of inline rendering.',
    });
    return;
  }
  if (!initialized) {
    fail(id, -32000, 'Initialize before making requests');
    return;
  }
  switch (method) {
    case 'tools/list':
      reply(id, { tools });
      break;
    case 'resources/list':
      reply(id, {
        resources: [{ uri: resourceUri, name: 'Arco Inline Probe card', mimeType }],
      });
      break;
    case 'resources/templates/list':
      reply(id, { resourceTemplates: [] });
      break;
    case 'tools/call': {
      const tool = tools.find(item => item.name === params.name);
      if (!tool) {
        fail(id, -32602, 'Unknown tool');
        break;
      }
      const args = params.arguments ?? {};
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) {
        fail(id, -32602, 'This probe accepts only empty arguments: {}');
        break;
      }
      const probe = {
        marker: 'ARCO INLINE PROBE',
        issue: 'yu/Arco #42',
        title: 'Issueを会話へ渡す',
        status: 'In progress',
        serverToken,
        linkage: tool.name === 'render_inline_probe' ? 'standard ui.resourceUri' : 'compat openai/outputTemplate',
      };
      reply(id, {
        content: [{ type: 'text', text: JSON.stringify(probe) }],
        structuredContent: probe,
      });
      break;
    }
    case 'resources/read':
      if (params.uri !== resourceUri) {
        fail(id, -32602, 'Unknown resource URI');
        break;
      }
      reply(id, {
        contents: [{
          uri: resourceUri,
          mimeType,
          text: html,
          _meta: {
            ui: {
              prefersBorder: true,
              csp: { connectDomains: [], resourceDomains: [] },
            },
            'openai/ui': {
              availableDisplayModes: ['inline'],
              preferredDisplayMode: 'inline',
            },
          },
        }],
      });
      break;
    default:
      fail(id, -32601, 'Method not found: ' + method);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(null, -32700, 'Parse error');
    return;
  }
  try {
    dispatch(message);
  } catch (error) {
    process.stderr.write('Inline probe request failed: ' + error.message + '\n');
    if (Object.hasOwn(message ?? {}, 'id')) fail(message.id, -32603, 'Internal error');
  }
});
