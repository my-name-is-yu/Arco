import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFixtureBackend, createLiveBackend } from "./composition";
import { createArcoServer } from "./mcp";
declare const __ARCO_FIXTURE__: boolean;
const backend = await (__ARCO_FIXTURE__
  ? createFixtureBackend()
  : createLiveBackend());
let cleanedUp = false;
const cleanup = () => {
  if (cleanedUp) return;
  cleanedUp = true;
  backend.cleanup();
};
process.once("exit", cleanup);
const server = createArcoServer(backend);
if (!backend.fixture) {
  // EOF stops new input; dispatched operations can still finish and reply.
  process.stdin.once("end", cleanup);
  server.server.onclose = cleanup;
}
await server.connect(new StdioServerTransport());
