import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const script = new URL("../scripts/app-server-client.mjs", import.meta.url)
  .href;
type Protocol = {
  call(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  close(): void;
};
type Options = {
  timeoutMs?: number;
  formatError?: (method: string, error: { message: string }) => string;
};
const {
  createAppServerClient,
}: {
  createAppServerClient: (
    child: ChildProcessWithoutNullStreams,
    options?: Options,
  ) => Protocol;
} = await import(script);

const fixture = `
  import { createInterface } from 'node:readline';
  let held;
  let initialized = false;
  const reply = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
  createInterface({ input: process.stdin }).on('line', (line) => {
    const message = JSON.parse(line);
    if (message.id === undefined) {
      if (message.method === 'initialized') initialized = true;
      return;
    }
    if (message.method === 'hold' || message.method === 'first') {
      held = message;
    } else if (message.method === 'second') {
      reply({ method: 'progress', params: {} });
      process.stdout.write('not JSON\\nnull\\n');
      reply({ id: 9999, result: 'unrelated' });
      reply({ id: message.id, result: { order: 'second', initialized } });
      reply({ id: held.id, result: { order: 'first', initialized } });
    } else if (message.method === 'release') {
      reply({ id: held.id, result: 'late response' });
      reply({ id: message.id, result: true });
    } else if (message.method === 'failure') {
      reply({ id: message.id, error: { message: 'fixture failure' } });
    } else if (message.method === 'exit') {
      process.exit(0);
    } else {
      reply({ id: message.id, result: message.params });
    }
  });
  // Keep stdin failure distinct from child exit; the test owns termination.
  setInterval(() => {}, 60_000);
  process.stdout.write('ready\\n');
`;

const running: { child: ChildProcessWithoutNullStreams; protocol: Protocol }[] =
  [];
async function start(options?: Options) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", fixture]);
  await once(child.stdout, "data");
  const protocol = createAppServerClient(child, options);
  running.push({ child, protocol });
  return { child, protocol };
}
afterEach(async () => {
  for (const { child, protocol } of running.splice(0)) {
    protocol.close();
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});

describe("validation app-server protocol", () => {
  it("matches out-of-order replies while ignoring notifications and unrelated or malformed lines", async () => {
    const { protocol } = await start();
    protocol.notify("initialized", {});
    const first = protocol.call("first", {});
    const second = protocol.call("second", {});
    await expect(Promise.all([first, second])).resolves.toEqual([
      { order: "first", initialized: true },
      { order: "second", initialized: true },
    ]);
    await expect(
      protocol.call("echo", { text: "保留中", value: false }),
    ).resolves.toEqual({
      text: "保留中",
      value: false,
    });
  });

  it("keeps RPC errors generic by default and permits the installed-plugin probe's diagnostic format", async () => {
    const generic = await start();
    await expect(generic.protocol.call("failure", {})).rejects.toThrow(
      "failure failed",
    );
    const diagnostic = await start({
      formatError: (method, error) => `${method}: ${error.message}`,
    });
    await expect(diagnostic.protocol.call("failure", {})).rejects.toThrow(
      "failure: fixture failure",
    );
  });

  it("times out only that request and ignores its late response without closing the client", async () => {
    const { protocol } = await start({ timeoutMs: 200 });
    await expect(protocol.call("hold", {})).rejects.toThrow("hold timed out");
    await expect(protocol.call("release", {})).resolves.toBe(true);
    await expect(protocol.call("echo", "still usable")).resolves.toBe(
      "still usable",
    );
  });

  it("rejects pending and future calls when the real child exits", async () => {
    const { protocol } = await start();
    const held = protocol
      .call("hold", {})
      .catch((error: Error) => error.message);
    const exiting = protocol
      .call("exit", {})
      .catch((error: Error) => error.message);
    await expect(Promise.all([held, exiting])).resolves.toEqual([
      "hold failed",
      "exit failed",
    ]);
    await expect(protocol.call("echo", {})).rejects.toThrow("echo failed");
  });

  it("rejects pending calls on stdin failure even while the child remains alive", async () => {
    const { child, protocol } = await start();
    const held = protocol
      .call("hold", {})
      .catch((error: Error) => error.message);
    child.stdin.destroy(new Error("fixture pipe failure"));
    await expect(held).resolves.toBe("hold failed");
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBeNull();
    await expect(protocol.call("echo", {})).rejects.toThrow("echo failed");
  });

  it("closes pending requests and their timers without taking ownership of process shutdown", async () => {
    const { protocol, child } = await start();
    const held = protocol
      .call("hold", {})
      .catch((error: Error) => error.message);
    protocol.close();
    await expect(held).resolves.toBe("hold failed");
    expect(child.exitCode).toBeNull();
    expect(() => protocol.notify("initialized", {})).toThrow(
      "App-server client is closed.",
    );
    await expect(protocol.call("echo", {})).rejects.toThrow("echo failed");
  });

  it("leaves no request timer keeping a caller alive after protocol cleanup", async () => {
    const runner = `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { createAppServerClient } from ${JSON.stringify(script)};
      const child = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(fixture)}]);
      await once(child.stdout, 'data');
      const protocol = createAppServerClient(child);
      const pending = protocol.call('hold', {}).catch(() => {});
      protocol.close();
      await pending;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
      console.log('closed');
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", runner],
      { timeout: 5000 },
    );
    expect(stdout.trim()).toBe("closed");
  }, 10_000);
});
