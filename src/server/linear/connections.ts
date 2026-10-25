import {
  all,
  named,
  type Args,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createConnectionsHandlers(operation: LinearOperation) {
  async function connection(
    name: "linear_connection" | "linear_scopes",
    input: Args<"linear_connection">,
  ) {
    if (!(await operation.auth.hasConnection(input.connectionId)))
      return {
        connectionId: input.connectionId,
        connected: false,
        mode: "linear",
        account: null,
        userId: null,
        workspace: null,
        message: "Authorize Arco with Linear to connect.",
      };
    const client = operation.makeClient(
      await operation.auth.accessToken(input.connectionId),
    );
    const [viewer, organization] = await Promise.all([
      client.viewer,
      client.organization,
    ]);
    if (name === "linear_connection")
      return {
        connectionId: input.connectionId,
        connected: true,
        mode: "linear",
        account: viewer.name,
        userId: viewer.id,
        workspace: named(organization),
        message: "Connected to Linear with your account permissions.",
      };
    return {
      workspace: named(organization),
      teams: (await all(client.teams({ first: 100 }))).map((team) => ({
        id: team.id,
        name: team.name,
        key: team.key,
      })),
    };
  }

  return {
    linear_auth_status: async (input) => {
      return {
        ...operation.auth.status(input.connectionId),
        connected: await operation.auth.hasConnection(input.connectionId),
      };
    },
    linear_auth_begin: async (input) => {
      return operation.auth.begin(
        input.connectionId,
        input.clientId,
        input.redirectUri,
      );
    },
    linear_auth_disconnect: async (input) => {
      return operation.auth.disconnect(input.connectionId, input.revoke);
    },
    linear_connection: (input) => connection("linear_connection", input),
    linear_scopes: (input) => connection("linear_scopes", input),
  } satisfies Pick<
    LinearHandlers,
    | "linear_auth_status"
    | "linear_auth_begin"
    | "linear_auth_disconnect"
    | "linear_connection"
    | "linear_scopes"
  >;
}
