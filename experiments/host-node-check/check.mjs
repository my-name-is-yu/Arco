import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const inherited = process.argv.includes('--inherit-host-node');
const childEnv = { ...process.env };
if (!inherited) delete childEnv.CODEX_MCP_NODE_PATH;
const proc = spawn('codex', ['app-server', '-c', 'features.remote_plugin=false', '-c', 'features.apps=false', '-c', `marketplaces.arco-host-node-check.source_type="local"`, '-c', `marketplaces.arco-host-node-check.source=${JSON.stringify(root)}`], { cwd: root, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
let sequence = 0;
const pending = new Map();
const notifications = [];
const errors = [];
proc.stderr.on('data', b => errors.push(b.toString()));
createInterface({ input: proc.stdout }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id != null) {
    const resolve = pending.get(msg.id);
    if (resolve) { pending.delete(msg.id); resolve(msg); }
  } else notifications.push(msg);
});
function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 25000);
    pending.set(id, value => { clearTimeout(timer); resolve(value); });
    proc.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  console.log(JSON.stringify({ inheritedHostNode: inherited, initialize: await call('initialize', { clientInfo: { name: 'arco-host-node-check', version: '0.0.1' }, capabilities: { experimentalApi: true } }) }));
  proc.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const listed = await call('plugin/list', { cwds: [root], marketplaceKinds: ['local'] });
  console.log(JSON.stringify({ pluginList: listed.result?.marketplaces?.filter(x => x.name === 'arco-host-node-check'), errors: listed.result?.marketplaceLoadErrors }));
  console.log(JSON.stringify({ installed: await call('plugin/install', { marketplacePath: `${root}.agents/plugins/marketplace.json`, pluginName: 'arco-host-node-check' }) }));
  const thread = await call('thread/start', { cwd: root, ephemeral: true });
  console.log(JSON.stringify({ threadStart: thread.error ?? { id: thread.result?.thread?.id } }));
  const threadId = thread.result?.thread?.id;
  const status = await call('mcpServerStatus/list', { threadId, detail: 'full' });
  console.log(JSON.stringify({ status: status.error ?? status.result?.data?.filter(x => x.name?.includes('arco-host-node-check')) }));
  const server = status.result?.data?.find(x => x.name?.includes('arco-host-node-check'));
  if (server && Object.keys(server.tools ?? {}).length) console.log(JSON.stringify({ tool: await call('mcpServer/tool/call', { threadId, server: server.name, tool: 'runtime_info', arguments: {} }) }));
  console.log(JSON.stringify({ startupEvents: notifications.filter(x => /mcpServer|startup/i.test(x.method) && x.params?.name?.includes('arco-host-node-check')) }));
} finally {
  console.log(JSON.stringify({ uninstalled: await call('plugin/uninstall', { pluginId: 'arco-host-node-check@arco-host-node-check' }) }));
  proc.kill('SIGTERM');
  const filtered = errors.join('').split('\n').filter(x => /arco-host-node|node_path|server.mjs|exec:|Permission denied/i.test(x));
  if (filtered.length) console.log(JSON.stringify({ startupStderr: filtered }));
}
