import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  session: "00000000-0000-4000-8000-000000000001",
  request: undefined as
    undefined | ((request: unknown, response: unknown) => Promise<void>),
  signals: new Map<string, () => void>(),
  listen: vi.fn(),
  stop: vi.fn(),
  connect: vi.fn(),
  check: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:crypto", () => ({ randomUUID: () => fixture.session }));
vi.mock("node:http", () => ({
  createServer: (handler: typeof fixture.request) => {
    fixture.request = handler;
    return { listen: fixture.listen, close: fixture.stop };
  },
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue(""),
}));
vi.mock("esbuild", () => ({
  build: vi
    .fn()
    .mockResolvedValue({ outputFiles: [{ contents: Buffer.from("") }] }),
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = fixture.connect;
    callTool = fixture.check;
    close = fixture.close;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {},
}));

it("closes an unregistered fixture client when shutdown overlaps its pending fixture check", async () => {
  let release!: (value: unknown) => void;
  fixture.check.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  fixture.close.mockResolvedValue(undefined);
  const listen = process.on.bind(process);
  const on = vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      fixture.signals.set(event, listener as () => void);
      return process;
    }
    return listen(event, listener);
  });
  let request: Promise<void> | undefined;
  try {
    await import(new URL("../scripts/dev-host.mjs", import.meta.url).href);
    const response = { writeHead: vi.fn(), end: vi.fn() };
    request = fixture.request!(
      { method: "POST", url: "/session", headers: {} },
      response,
    );
    await vi.waitFor(() =>
      expect(fixture.check).toHaveBeenCalledExactlyOnceWith({
        name: "arco_connection",
        arguments: {},
      }),
    );
    fixture.signals.get("SIGTERM")!();
    release({ structuredContent: { mode: "fixture" } });
    await request;
    expect(fixture.stop).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(response.writeHead).toHaveBeenCalledOnce();
    expect(response.writeHead.mock.calls[0][0]).toBe(503);
    expect(response.end).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ error: "Mock host is shutting down" }),
    );
    const missing = { writeHead: vi.fn(), end: vi.fn() };
    await fixture.request!(
      {
        method: "POST",
        url: "/tool",
        headers: {},
        setEncoding() {},
        async *[Symbol.asyncIterator]() {
          yield JSON.stringify({
            session: fixture.session,
            name: "arco_connection",
          });
        },
      },
      missing,
    );
    expect(missing.writeHead.mock.calls[0][0]).toBe(404);
  } finally {
    release({ structuredContent: { mode: "fixture" } });
    try {
      await request;
    } finally {
      on.mockRestore();
    }
  }
});
