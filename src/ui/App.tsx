import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import type { LaunchContext } from "../shared/launch";
import { GitHubWorkspace } from "./GitHubWorkspace";
import { LinearWorkspace } from "./LinearWorkspace";
import { SelectionShare } from "./SelectionShare";
import { HostProvider, useHostView } from "./HostProvider";
import { WorkspaceSkeleton } from "./LoadingSkeleton";
import { sessionValue, useSessionState } from "./session-state";
import { useSettings } from "./useSettings";
function Workspace({
  host,
  launch,
}: {
  host: ArcoHost;
  launch: LaunchContext;
}) {
  const { mode, sharedIssue } = useHostView();
  const settings = useSettings(host);
  const [override, setOverride] = useSessionState<"github" | "linear" | null>(
    host,
    "active-source",
    () => {
      const restore = launch?.view !== "project" || mode === "inline";
      return (
        launch.target?.source ??
        launch.source ??
        (restore ? sharedIssue?.source : null) ??
        (launch?.view === "project" ? "github" : null)
      );
    },
  );
  if (settings.query.isPending) return <WorkspaceSkeleton mode={mode} />;
  const source =
    (mode === "inline" ? launch.target?.source : undefined) ??
    override ??
    settings.query.data?.settings.activeSource ??
    "github";
  const changeSource = (next: "github" | "linear") => {
    setOverride(next);
    if (launch.view !== "project")
      settings.update(() => ({ activeSource: next }));
  };
  return source === "github" ? (
    <GitHubWorkspace
      host={host}
      launch={launch}
      onSourceChange={changeSource}
    />
  ) : (
    <LinearWorkspace
      host={host}
      launch={launch}
      onSourceChange={changeSource}
    />
  );
}
function LaunchWorkspace({ host }: { host: ArcoHost }) {
  const { launch, mode } = useHostView();
  const error = host.launchError?.();
  return launch ? (
    <Workspace host={host} launch={launch} />
  ) : error ? (
    <main className="arco empty-state" role="alert">
      <h1>Could not open Arco</h1>
      <p>{error}</p>
    </main>
  ) : (
    <WorkspaceSkeleton mode={mode} />
  );
}
export function App({ host }: { host: ArcoHost }) {
  const client = sessionValue(
    host,
    "query-client",
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15_000,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <HostProvider host={host}>
        <LaunchWorkspace host={host} />
        <SelectionShare host={host} />
      </HostProvider>
    </QueryClientProvider>
  );
}
export default App;
