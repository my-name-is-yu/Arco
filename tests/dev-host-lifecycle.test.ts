import { readFile } from "node:fs/promises";
import { beforeEach, expect, it, vi } from "vitest";

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

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.signals.clear();
  fixture.connect.mockReset();
  fixture.check.mockReset();
  fixture.close.mockReset();
});

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

it("counts starting fixture sessions toward capacity and frees failed reservations", async () => {
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
  const requests: Promise<void>[] = [];
  try {
    await import(new URL("../scripts/dev-host.mjs", import.meta.url).href);
    const request = { method: "POST", url: "/session", headers: {} };
    const starting = { writeHead: vi.fn(), end: vi.fn() };
    const overflow = { writeHead: vi.fn(), end: vi.fn() };
    // Simulate 255 retained sessions without spawning their fixture processes.
    // Restore the built-in before yielding to the imports and startup checks.
    const capacity = vi
      .spyOn(Map.prototype, "size", "get")
      .mockReturnValue(255);
    try {
      requests.push(fixture.request!(request, starting));
      requests.push(fixture.request!(request, overflow));
    } finally {
      capacity.mockRestore();
    }
    expect(overflow.writeHead).toHaveBeenCalledOnce();
    expect(overflow.writeHead.mock.calls[0][0]).toBe(429);
    release({ structuredContent: { mode: "not-fixture" } });
    await Promise.all(requests);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(fixture.check).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
    expect(starting.writeHead.mock.calls[0][0]).toBe(500);
    fixture.check.mockResolvedValue({ structuredContent: { mode: "fixture" } });
    const recovered = { writeHead: vi.fn(), end: vi.fn() };
    const capacityAfterFailure = vi
      .spyOn(Map.prototype, "size", "get")
      .mockReturnValue(255);
    try {
      requests.push(fixture.request!(request, recovered));
    } finally {
      capacityAfterFailure.mockRestore();
    }
    await Promise.all(requests);
    expect(recovered.writeHead.mock.calls[0][0]).toBe(200);
    expect(fixture.connect).toHaveBeenCalledTimes(2);
    expect(fixture.check).toHaveBeenCalledTimes(2);
    await fixture.request!(
      {
        method: "DELETE",
        url: `/session/${fixture.session}`,
        headers: {},
      },
      { writeHead: vi.fn(), end: vi.fn() },
    );
    expect(fixture.close).toHaveBeenCalledTimes(2);
  } finally {
    release({ structuredContent: { mode: "not-fixture" } });
    await Promise.allSettled(requests);
    fixture.signals.get("SIGTERM")?.();
    on.mockRestore();
  }
});

it("returns one error response when a rebuild removes the UI asset and serves a later retry", async () => {
  const listen = process.on.bind(process);
  const on = vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGINT" || event === "SIGTERM") {
      fixture.signals.set(event, listener as () => void);
      return process;
    }
    return listen(event, listener);
  });
  const response = () => {
    let headersSent = false;
    return {
      writeHead: vi.fn<
        (status: number, headers: Record<string, string>) => void
      >(() => {
        if (headersSent)
          throw Object.assign(new Error("Cannot write headers twice"), {
            code: "ERR_HTTP_HEADERS_SENT",
          });
        headersSent = true;
      }),
      end: vi.fn(),
    };
  };
  try {
    await import(new URL("../scripts/dev-host.mjs", import.meta.url).href);
    const request = { method: "GET", url: "/arco.html", headers: {} };
    vi.mocked(readFile).mockRejectedValueOnce(
      new Error("UI asset is rebuilding"),
    );
    const missing = response();
    await expect(fixture.request!(request, missing)).resolves.toBeUndefined();
    expect(missing.writeHead).toHaveBeenCalledOnce();
    expect(missing.writeHead.mock.calls[0][0]).toBe(500);
    expect(missing.end).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ error: "UI asset is rebuilding" }),
    );
    const html = Buffer.from("<!doctype html><main>Rebuilt fixture</main>");
    vi.mocked(readFile).mockResolvedValueOnce(html);
    const rebuilt = response();
    await fixture.request!(request, rebuilt);
    expect(rebuilt.writeHead).toHaveBeenCalledOnce();
    expect(rebuilt.writeHead.mock.calls[0][0]).toBe(200);
    expect(rebuilt.end).toHaveBeenCalledExactlyOnceWith(html);
  } finally {
    fixture.signals.get("SIGTERM")?.();
    on.mockRestore();
  }
});
