import { OperationError } from "../shared/errors";
import {
  symphonyToolSchemas,
  type SymphonyConnection,
  type SymphonyService,
} from "../shared/symphony";
import { parseSymphonyState, type SymphonyServiceOptions } from "./symphony";

/** IDs and URLs intentionally match Arco's existing GitHub and Linear fixtures. */
export const SYMPHONY_FIXTURE_CONNECTIONS: SymphonyConnection[] = [
  {
    id: "fixture-symphony-github",
    name: "GitHub Symphony fixture",
    baseUrl: "https://symphony-fixture.invalid/github",
    binding: {
      source: "github",
      repo: "yu/Arco",
      prepareLabels: ["design"],
      reviewLabels: ["enhancement"],
    },
  },
  {
    id: "fixture-symphony-linear",
    name: "Linear Symphony fixture",
    baseUrl: "https://symphony-fixture.invalid/linear",
    binding: {
      source: "linear",
      connectionId: "default",
      workspaceId: "fixture-linear-workspace",
      teamId: "fixture-linear-team",
      prepareStateIds: ["linear-state-todo"],
      reviewStateIds: ["linear-state-done"],
    },
  },
];

export function createSymphonyFixtureService(
  options: Pick<SymphonyServiceOptions, "readSettings"> = {
    readSettings: async () => ({
      settings: { symphonyConnections: SYMPHONY_FIXTURE_CONNECTIONS },
    }),
  },
): SymphonyService {
  async function snapshot(connection: SymphonyConnection) {
    if (connection.baseUrl.includes("/unavailable"))
      throw new OperationError(
        "The Symphony fixture is unavailable. This is fictional local data.",
        "unavailable",
      );
    const now = new Date().toISOString();
    const linear = connection.binding?.source === "linear";
    return parseSymphonyState(
      {
        generated_at: now,
        running: linear
          ? []
          : [
              {
                issue_id: "42",
                issue_identifier: "GH-42",
                issue_url: "https://github.com/yu/Arco/issues/42",
                state: "open",
                session_id: "fixture-thread-42-fixture-turn-1",
                started_at: now,
                last_event_at: now,
                last_event: "notification",
                last_message:
                  "Fixture: checking selection and scroll preservation.",
                turn_count: 2,
                tokens: {
                  input_tokens: 2400,
                  output_tokens: 600,
                  total_tokens: 3000,
                },
                worker_host: "fixture-worker",
                workspace_path: "/fixture/symphony/GH-42",
              },
            ],
        retrying: linear
          ? []
          : [
              {
                issue_id: "43",
                issue_identifier: "GH-43",
                issue_url: "https://github.com/yu/Arco/issues/43",
                attempt: 2,
                due_at: new Date(Date.now() + 60_000).toISOString(),
                error: "Fixture: temporary worker connection failure.",
              },
            ],
        blocked: [
          linear
            ? {
                issue_id: "fixture-linear-42",
                issue_identifier: "YU-42",
                issue_url: "https://linear.app/fixture/issue/YU-42",
                state: "In Progress",
                session_id: "fixture-linear-thread-42-fixture-turn-1",
                blocked_at: now,
                last_event_at: now,
                last_event: "approval_required",
                last_message: "Fixture: operator input is required.",
                error:
                  "Fixture: Codex requested approval. No live session is waiting here.",
              }
            : {
                issue_id: "999",
                issue_identifier: "GH-999",
                issue_url: "https://github.com/yu/Arco/issues/999",
                state: "open",
                blocked_at: now,
                last_event_at: now,
                last_event: "turn_input_required",
                last_message:
                  "Fixture: this runtime has no matching issue in Arco's native fixture list.",
                error: "Fixture: external input required.",
              },
        ],
        codex_totals: {
          input_tokens: linear ? 0 : 2400,
          output_tokens: linear ? 0 : 600,
          total_tokens: linear ? 0 : 3000,
          seconds_running: linear ? 0 : 150,
        },
        rate_limits: { primary: { used_percent: 12, window_minutes: 300 } },
      },
      connection.id,
    );
  }
  async function saved(connectionId: string) {
    const connection = (
      await options.readSettings()
    ).settings.symphonyConnections.find((item) => item.id === connectionId);
    if (!connection)
      throw new OperationError(
        "This Symphony fixture connection is no longer saved.",
        "not-found",
      );
    return connection;
  }
  return {
    async getState(input) {
      const { connectionId } =
        symphonyToolSchemas.arco_symphony_state.parse(input);
      return snapshot(await saved(connectionId));
    },
    async getIssue(input) {
      const { connectionId, issueIdentifier } =
        symphonyToolSchemas.arco_symphony_issue.parse(input);
      const state = await snapshot(await saved(connectionId));
      const runtime =
        state.rows.find((row) => row.issueIdentifier === issueIdentifier) ??
        null;
      return {
        connectionId,
        issueIdentifier,
        found: runtime !== null,
        runtime,
      };
    },
    async probe(input) {
      const { baseUrl } =
        symphonyToolSchemas.arco_symphony_test_connection.parse(input);
      const connection = SYMPHONY_FIXTURE_CONNECTIONS.find(
        (item) => item.baseUrl === baseUrl,
      );
      if (!connection)
        throw new OperationError(
          "Fixture mode can test only its fictional Symphony URLs. Use the live plugin to test a service.",
          "unsupported",
        );
      return snapshot({ ...connection, id: "probe" });
    },
  };
}
