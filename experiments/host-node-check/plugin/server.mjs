import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'arco-host-node-check', version: '0.0.1' });
server.registerTool('runtime_info', {
  description: 'Return non-secret runtime evidence for this isolated check.',
  annotations: { readOnlyHint: true },
}, async () => ({
  content: [{ type: 'text', text: JSON.stringify({
    nodeVersion: process.version,
    hostNodeVariablePresent: Boolean(process.env.CODEX_MCP_NODE_PATH),
    sameExecutable: process.execPath === process.env.CODEX_MCP_NODE_PATH,
  }) }],
}));
await server.connect(new StdioServerTransport());
