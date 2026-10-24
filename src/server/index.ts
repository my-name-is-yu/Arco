import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createFixtureBackend, createLiveBackend } from "./composition";
import { createArcoServer } from "./mcp";
declare const __ARCO_FIXTURE__: boolean;
const backend = await (__ARCO_FIXTURE__
  ? createFixtureBackend()
  : createLiveBackend());
process.on("exit", backend.cleanup);
await createArcoServer(backend).connect(new StdioServerTransport());
