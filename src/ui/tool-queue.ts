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
  const waiting: WaitingRequest[] = [];
  let active = 0;
  let backgroundActive = 0;
  let closed = false;
  const closedError = () =>
    new Error("Arco is closed. This request was not started.");

  const drain = () => {
    while (!closed && active < 2 && waiting.length) {
      // Reserve one RPC slot for explicit actions even while previews are slow.
      const index = waiting.findIndex(
        (request) => request.priority === "interactive" || backgroundActive < 1,
      );
      if (index < 0) break;
      active += 1;
      const [request] = waiting.splice(index, 1);
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
        const cancel = () => {
          const index = waiting.indexOf(pending);
          if (index < 0) return;
          waiting.splice(index, 1);
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
        // Explicit actions keep arrival order, ahead of deferred previews.
        const background = waiting.findIndex(
          (item) => item.priority === "background",
        );
        if (priority === "interactive" && background >= 0)
          waiting.splice(background, 0, pending);
        else waiting.push(pending);
        signal?.addEventListener("abort", cancel, { once: true });
        drain();
      });
    },
    close() {
      closed = true;
      for (const request of waiting.splice(0)) {
        request.cleanup();
        request.reject(closedError());
      }
    },
  };
}
