import { createHash, randomUUID } from "node:crypto";
import { LinearClient } from "@linear/sdk";
import { z } from "zod";
import {
  linearSchemas,
  type LinearService,
  type LinearToolName,
} from "../../shared/linear";
import { createWriteGuard, getWriteProgress } from "../write-guard";
import { createAttachmentsHandlers } from "./attachments";
import type { LinearAuth } from "./auth";
import { createBulkHandlers } from "./bulk";
import { createCommentsHandlers } from "./comments";
import { createConnectionsHandlers } from "./connections";
import { createIssuesHandlers } from "./issues";
import {
  createLinearOperation,
  type Args,
  type LinearHandlers,
} from "./operation";
import { createQueriesHandlers } from "./queries";
import { createRelationsHandlers } from "./relations";
import { LinearServiceError, linearFailure } from "./errors";
export { describeTemplate, estimateValues } from "./operation";
export function createLinearService(options: {
  auth: LinearAuth;
  client?: (accessToken: string) => LinearClient;
  fetch?: typeof fetch;
}): LinearService {
  const auth = options.auth;
  const makeClient =
    options.client ??
    ((accessToken: string) => new LinearClient({ accessToken }));
  const request = options.fetch ?? fetch;
  const identities = new Map<
    string,
    { fingerprint: string; generation: string }
  >();
  function generationFor(connectionId: string, fingerprint: string) {
    let identity = identities.get(connectionId);
    if (identity?.fingerprint !== fingerprint) {
      identity = { fingerprint, generation: randomUUID() };
      identities.set(connectionId, identity);
    }
    return identity.generation;
  }
  const once = createWriteGuard<
    object,
    readonly [LinearToolName, { connectionId: string }]
  >(
    256,
    (message, code = "unavailable") => new LinearServiceError(message, code),
    async ([, input]) =>
      JSON.stringify([
        input.connectionId,
        await auth.sessionScope(input.connectionId),
      ]),
  );
  async function execute<N extends LinearToolName>(
    name: N,
    input: Args<N>,
  ): Promise<object> {
    let fingerprint: string | undefined;
    let readGeneration: string | undefined;
    const operation = createLinearOperation({
      auth,
      client: (token) => {
        fingerprint = createHash("sha256").update(token).digest("hex");
        if ("connectionId" in input && !("requestId" in input))
          readGeneration ??= generationFor(input.connectionId, fingerprint);
        return makeClient(token);
      },
      fetch: request,
    });
    const issues = createIssuesHandlers(operation);
    const handlers: LinearHandlers = {
      ...issues.handlers,
      ...createConnectionsHandlers(operation),
      ...createQueriesHandlers(operation),
      ...createCommentsHandlers(operation),
      ...createRelationsHandlers(operation),
      ...createAttachmentsHandlers(operation),
      ...createBulkHandlers(operation, issues),
    };
    try {
      const result = await handlers[name](input);
      if (fingerprint && "connectionId" in input && !("requestId" in input)) {
        const current = createHash("sha256")
          .update(await auth.accessToken(input.connectionId))
          .digest("hex");
        if (
          fingerprint !== current ||
          readGeneration !== generationFor(input.connectionId, current)
        )
          throw new LinearServiceError(
            "Linear authentication changed while loading data. Refresh to verify the current account.",
            "auth",
          );
      }
      if (
        name === "linear_connection" &&
        fingerprint &&
        "connectionId" in input
      ) {
        return {
          ...result,
          authGeneration: readGeneration,
        };
      }
      return result;
    } catch (error) {
      const progress = getWriteProgress();
      const failure = linearFailure(error, {
        write: progress.confirmed || progress.uncertain,
      });
      if (progress.confirmed && failure.code !== "uncertain")
        throw new LinearServiceError(
          `An earlier step completed in Linear. ${failure.message} Check Linear and refresh before retrying.`,
          "uncertain",
        );
      throw failure;
    }
  }
  return {
    async authGeneration(connectionId) {
      const fingerprint = createHash("sha256")
        .update(await auth.accessToken(connectionId))
        .digest("hex");
      return generationFor(connectionId, fingerprint);
    },
    async call(name, args) {
      const parsed = linearSchemas[name].parse(args);
      if ("requestId" in parsed)
        return once(z.string().parse(parsed.requestId), [name, parsed], () =>
          execute(name, parsed),
        );
      return execute(name, parsed);
    },
  };
}
