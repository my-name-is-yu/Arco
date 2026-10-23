type WaitingRequest = {
  start: () => void;
  reject: (error: Error) => void;
};

export function createToolQueue() {
  const waiting: WaitingRequest[] = [];
  let active = 0;
  let closed = false;
  const closedError = () =>
    new Error("Arco is closed. This request was not started.");

  const drain = () => {
    while (!closed && active < 2 && waiting.length) {
      active += 1;
      waiting.shift()!.start();
    }
  };
  const complete = () => {
    active -= 1;
    drain();
  };

  return {
    run<T>(request: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(closedError());
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          reject,
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
                complete();
              },
              (error: unknown) => {
                reject(error);
                complete();
              },
            );
          },
        });
        drain();
      });
    },
    close() {
      closed = true;
      for (const request of waiting.splice(0)) request.reject(closedError());
    },
  };
}
