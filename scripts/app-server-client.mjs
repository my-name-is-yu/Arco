import { createInterface } from "node:readline";
import { setTimeout, clearTimeout } from "node:timers";

// Only the line-delimited protocol lives here; callers own the child process.
export function createAppServerClient(
  child,
  { timeoutMs = 25_000, formatError = (method) => `${method} failed` } = {},
) {
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  const fail = () => {
    closed = true;
    for (const complete of pending.values()) complete();
  };
  child.on("error", fail);
  child.on("exit", fail);
  child.stdin.on("error", fail);
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    pending.get(message?.id)?.(message);
  });
  const notify = (method, params) => {
    if (closed) throw new Error("App-server client is closed.");
    child.stdin.write(JSON.stringify({ method, params }) + "\n");
  };
  return {
    call(method, params) {
      if (closed) return Promise.reject(new Error(`${method} failed`));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, (message) => {
          clearTimeout(timer);
          pending.delete(id);
          if (!message) reject(new Error(`${method} failed`));
          else if (message.error)
            reject(new Error(formatError(method, message.error)));
          else resolve(message.result);
        });
        try {
          child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
        } catch {
          fail();
        }
      });
    },
    notify,
    close() {
      fail();
      lines.close();
    },
  };
}
