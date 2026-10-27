import {
  test as base,
  type APIRequestContext,
  type APIResponse,
  type Response,
} from "@playwright/test";

export * from "@playwright/test";

export const test = base.extend<{ fixtureSessions: void }>({
  fixtureSessions: [
    async ({ context, request, baseURL }, runTest, testInfo) => {
      const sessionUrl = new URL("/session", baseURL).href;
      const sessions = new Set<string>();
      const pending: Promise<void>[] = [];
      const failures: unknown[] = [];
      const remember = async (response: APIResponse | Response) => {
        if (response.url() !== sessionUrl || !response.ok()) return;
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("session" in result) ||
          typeof result.session !== "string"
        )
          throw new Error("Fixture session response did not include its ID.");
        sessions.add(result.session);
      };
      const onResponse = (response: Response) => {
        if (
          response.request().method() !== "POST" ||
          response.url() !== sessionUrl
        )
          return;
        pending.push(
          remember(response).catch((error: unknown) => {
            failures.push(error);
          }),
        );
      };
      const observeApi = (api: APIRequestContext) => {
        const post = api.post;
        const send = post.bind(api);
        api.post = async <T>(
          ...args: Parameters<APIRequestContext["post"]>
        ) => {
          const response = send<T>(...args);
          if (new URL(args[0], baseURL).href === sessionUrl)
            pending.push(
              response.then(remember).catch((error: unknown) => {
                failures.push(error);
              }),
            );
          return response;
        };
        return () => {
          api.post = post;
        };
      };
      // APIRequestContext requests do not emit browser response events.
      const restore = [observeApi(context.request), observeApi(request)];
      context.on("response", onResponse);
      try {
        await runTest();
      } catch (error) {
        failures.push(error);
      } finally {
        // A failed test may leave a deliberately blocked route handler.
        const behavior =
          testInfo.status === "passed" && !failures.length
            ? "wait"
            : "ignoreErrors";
        const routes = await Promise.allSettled([
          ...context.pages().map((page) => page.unrouteAll({ behavior })),
          context.unrouteAll({ behavior }),
        ]);
        for (const result of routes)
          if (result.status === "rejected") failures.push(result.reason);
        context.off("response", onResponse);
        await Promise.all(pending);
        restore.forEach((restoreApi) => restoreApi());
        // Stop page requests before closing the backend they use.
        try {
          await context.close();
        } catch (error) {
          failures.push(error);
        }
        const closed = await Promise.allSettled(
          [...sessions].map(async (session) => {
            const response = await request.delete(
              new URL(`/session/${encodeURIComponent(session)}`, baseURL).href,
            );
            if (!response.ok())
              throw new Error(
                `Could not close fixture session: ${response.status()}`,
              );
          }),
        );
        for (const result of closed)
          if (result.status === "rejected") failures.push(result.reason);
      }
      if (failures.length)
        throw new AggregateError(failures, "Fixture session cleanup failed.");
    },
    { auto: true },
  ],
});
