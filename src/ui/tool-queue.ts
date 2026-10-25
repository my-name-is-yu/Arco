type WaitingRequest = {
  start: () => void;
  reject: (error: Error) => void;
  priority: "background" | "interactive";
  cleanup: () => void;
};

export type ToolRequestOptions = {
  signal?: AbortSignal;
  priority?: "background" | "interactive";
};

export function createToolQueue() {
  const waiting: Record<WaitingRequest["priority"], WaitingRequest[]> = {
    interactive: [],
    background: [],
  };
  let active = 0;
  let backgroundActive = 0;
  let closed = false;
  const closedError = () =>
    new Error("Arco is closed. This request was not started.");

  const drain = () => {
    while (!closed && active < 2) {
      // Reserve one RPC slot for explicit actions even while previews are slow.
      const request =
        waiting.interactive.shift() ??
        (backgroundActive < 1 ? waiting.background.shift() : undefined);
      if (!request) break;
      active += 1;
      if (request.priority === "background") backgroundActive += 1;
      request.cleanup();
      request.start();
    }
  };
  const complete = (priority: WaitingRequest["priority"]) => {
    active -= 1;
    if (priority === "background") backgroundActive -= 1;
    drain();
  };

  return {
    run<T>(
      request: () => Promise<T>,
      options: ToolRequestOptions = {},
    ): Promise<T> {
      if (closed) return Promise.reject(closedError());
      const { signal, priority = "interactive" } = options;
      const abortedError = () =>
        new DOMException(
          "This read is no longer needed and was not started.",
          "AbortError",
        );
      if (signal?.aborted) return Promise.reject(abortedError());
      return new Promise<T>((resolve, reject) => {
        const queue = waiting[priority];
        const cancel = () => {
          const index = queue.indexOf(pending);
          if (index < 0) return;
          queue.splice(index, 1);
          pending.cleanup();
          reject(abortedError());
        };
        const pending: WaitingRequest = {
          reject,
          priority,
          cleanup: () => signal?.removeEventListener("abort", cancel),
          start: () => {
            let result: Promise<T>;
            try {
              result = Promise.resolve(request());
            } catch (error) {
              result = Promise.reject(error);
            }
            void result.then(
              (value) => {
                resolve(value);
                complete(priority);
              },
              (error: unknown) => {
                reject(error);
                complete(priority);
              },
            );
          },
        };
        queue.push(pending);
        signal?.addEventListener("abort", cancel, { once: true });
        drain();
      });
    },
    close() {
      closed = true;
      for (const request of [
        ...waiting.interactive.splice(0),
        ...waiting.background.splice(0),
      ]) {
        request.cleanup();
        request.reject(closedError());
      }
    },
  };
}
