import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { z } from "zod";

// Development only: this server refuses to run against the production MCP.
const fixtureServer = fileURLToPath(
  new URL("../dist/dev/server.mjs", import.meta.url),
);
await readFile(fixtureServer);
const port = z.coerce
  .number()
  .int()
  .min(1024)
  .max(65535)
  .parse(process.env.ARCO_DEV_PORT ?? 4174);
const origin = `http://127.0.0.1:${port}`;
const toolDelayMs = z.coerce
  .number()
  .int()
  .min(0)
  .max(5000)
  .parse(process.env.ARCO_DEV_TOOL_DELAY_MS ?? 0);
const bundled = await build({
  entryPoints: ["tests/host.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2023",
});
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arco — Mock MCP Apps host</title><style>*{box-sizing:border-box}body{margin:0;background:#121212;color:#ddd;font:12px system-ui}header{display:flex;align-items:center;gap:10px;padding:10px;flex-wrap:wrap}header strong{margin-right:auto}button,input{font:inherit}iframe{display:block;width:100%;height:calc(100vh - 115px);border:0;background:#191919}details{padding:4px 10px}pre{white-space:pre-wrap;max-height:180px;overflow:auto}#harness-error{color:#ffacac}</style><header><strong>MOCK HOST · fixture only · Not the Codex app</strong><span id="bridge-status">connecting</span><button id="mode-inline">Mock inline</button><button id="mode-fullscreen">Mock fullscreen</button><button id="external-update">Mock external update #42</button><button id="linear-external-update">Mock Linear external update YU-42</button><form id="mention-form"><input id="mention-query" aria-label="Mock @Arco search" value="repo:yu/Arco"><button>Mock @Arco search</button></form></header><div id="harness-error" role="alert"></div><details><summary>Mock host events</summary><button id="host-context-burst">Mock presentation updates</button><pre id="events">[]</pre></details><iframe id="arco" title="Arco fixture application"></iframe><script type="module" src="/host.js"></script></html>`;
const sessions = new Map();
const toolInput = z.object({
  session: z.string().uuid(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
const presentationInput = toolInput.pick({ session: true, name: true });
async function body(request) {
  request.setEncoding("utf8");
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Request too large");
  }
  return JSON.parse(value || "{}");
}
function json(response, value, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  try {
    if (request.headers.origin && request.headers.origin !== origin)
      return json(response, { error: "Same origin requests only" }, 403);
    const path = new URL(request.url ?? "/", origin).pathname;
    if (request.method === "POST" && path === "/session") {
      if (sessions.size >= 256)
        return json(
          response,
          { error: "Restart mock host to reset fixture sessions" },
          429,
        );
      const { Client } =
        await import("@modelcontextprotocol/sdk/client/index.js");
      const { StdioClientTransport } =
        await import("@modelcontextprotocol/sdk/client/stdio.js");
      const client = new Client({
        name: "Arco browser fixture host",
        version: "0.1.0",
      });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [fixtureServer],
          stderr: "pipe",
        }),
      );
      if (
        (
          await client.callTool({
            name: "arco_connection",
            arguments: {},
          })
        ).structuredContent?.mode !== "fixture"
      ) {
        await client.close();
        throw new Error("Mock host refuses a non-fixture MCP");
      }
      const session = randomUUID();
      sessions.set(session, client);
      return json(response, { session });
    }
    if (request.method === "DELETE" && path.startsWith("/session/")) {
      const session = z
        .string()
        .uuid()
        .safeParse(path.slice("/session/".length));
      if (!session.success)
        return json(response, { error: "Invalid fixture session" }, 400);
      const client = sessions.get(session.data);
      sessions.delete(session.data);
      await client?.close();
      return json(response, { closed: true });
    }
    if (request.method === "POST" && path === "/presentation") {
      const input = presentationInput.parse(await body(request));
      const client = sessions.get(input.session);
      if (!client)
        return json(response, { error: "Unknown fixture session" }, 404);
      const tool = (await client.listTools()).tools.find(
        (tool) => tool.name === input.name,
      );
      const uri = tool?._meta?.ui?.resourceUri;
      if (typeof uri !== "string")
        throw new Error("The fixture launch tool has no UI resource.");
      const content = (await client.readResource({ uri })).contents.find(
        (content) => content.uri === uri,
      );
      if (!content)
        throw new Error("The fixture UI resource was not returned.");
      return json(response, {
        tool,
        resource: { uri, mimeType: content.mimeType, _meta: content._meta },
      });
    }
    if (request.method === "POST" && path === "/tool") {
      const input = toolInput.parse(await body(request));
      const client = sessions.get(input.session);
      if (!client)
        return json(response, { error: "Unknown fixture session" }, 404);
      if (toolDelayMs) await setTimeout(toolDelayMs);
      return json(
        response,
        await client.callTool({ name: input.name, arguments: input.arguments }),
      );
    }
    if (request.method === "GET" && path === "/") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return response.end(html);
    }
    if (request.method === "GET" && path === "/host.js") {
      response.writeHead(200, {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
      });
      return response.end(bundled.outputFiles[0].contents);
    }
    if (request.method === "GET" && path === "/arco.html") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src data:;",
      });
      return response.end(await readFile("dist/plugin/arco.html"));
    }
    if (path === "/favicon.ico") {
      response.writeHead(204);
      return response.end();
    }
    json(response, { error: "Not found" }, 404);
  } catch (error) {
    json(
      response,
      { error: error instanceof Error ? error.message : "Mock host error" },
      500,
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Arco mock host (fixture only): ${origin}`),
);
async function shutdown() {
  server.close();
  await Promise.allSettled(
    [...sessions.values()].map((client) => client.close()),
  );
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
