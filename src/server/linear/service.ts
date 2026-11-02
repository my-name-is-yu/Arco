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
import { createLinearAuth, type LinearAuth } from "./auth";
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
export function createLinearService(
  options: {
    auth?: LinearAuth;
    client?: (accessToken: string) => LinearClient;
    fetch?: typeof fetch;
  } = {},
): LinearService {
  const auth = options.auth ?? createLinearAuth();
  const makeClient =
    options.client ??
    ((accessToken: string) => new LinearClient({ accessToken }));
  const request = options.fetch ?? fetch;
  const identities = new Map<
    string,
    { fingerprint: string; generation: string }
  >();
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
    const operation = createLinearOperation({
      auth,
      client: (token) => {
        fingerprint = createHash("sha256").update(token).digest("hex");
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
      if (
        name === "linear_connection" &&
        fingerprint &&
        "connectionId" in input
      ) {
        const connectionId = input.connectionId;
        let identity = identities.get(connectionId);
        if (identity?.fingerprint !== fingerprint) {
          identity = { fingerprint, generation: randomUUID() };
          identities.set(connectionId, identity);
        }
        return { ...result, authGeneration: identity.generation };
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
