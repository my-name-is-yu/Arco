import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import type { LaunchContext, NativeIssueTarget } from "../shared/launch";
import { GitHubWorkspace } from "./GitHubWorkspace";
import { LinearWorkspace } from "./LinearWorkspace";
import { SelectionShare } from "./SelectionShare";
import { HostProvider, useHostView } from "./HostProvider";
import { WorkspaceSkeleton } from "./LoadingSkeleton";
import { AsyncState } from "./AsyncState";
import {
  sessionValue,
  setSessionState,
  useSessionState,
} from "./session-state";
import { useSettings } from "./useSettings";
import { InlineIssueTabs, presentationTarget } from "./InlineIssueTabs";
import { seedPresentationCache } from "./presentation-cache";
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
      const restore = launch.view !== "project" || mode === "inline";
      return (
        launch.target?.source ??
        launch.source ??
        (restore ? sharedIssue?.source : null) ??
        (launch.view === "project" ? "github" : null)
      );
    },
  );
  if (settings.query.isPending) return <WorkspaceSkeleton mode={mode} />;
  if (settings.query.isError)
    return (
      <main className="arco empty-state">
        <AsyncState kind="error">
          <h1>Could not load local settings</h1>
          <p>{settings.query.error.message}</p>
          <button
            className="text-button"
            onClick={() => void settings.query.refetch()}
          >
            Retry loading settings
          </button>
        </AsyncState>
      </main>
    );
  const source =
    (mode === "inline" ? launch.target?.source : undefined) ??
    override ??
    settings.query.data.settings.activeSource;
  const changeSource = (next: "github" | "linear") => {
    setOverride(next);
    if (launch.view !== "project")
      settings.update("source", () => ({ activeSource: next }));
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
  const [openedIssue, setOpenedIssue] =
    useSessionState<NativeIssueTarget | null>(host, "issue-set:opened", null);
  const error = host.launchError();
  if (launch?.issues) {
    const target = openedIssue ?? presentationTarget(launch.issues[0]);
    const workspaceLaunch = { ...launch, target };
    delete workspaceLaunch.issues;
    const workspace = <Workspace host={host} launch={workspaceLaunch} />;
    return mode === "inline" ? (
      <InlineIssueTabs
        host={host}
        issues={launch.issues}
        activeTarget={target}
        onSelect={(issue) => {
          const target = presentationTarget(issue);
          setOpenedIssue(target);
          setSessionState(host, "active-source", target.source);
          if (target.source === "github") {
            setSessionState(host, "github:repoOverride", target.repo);
            setSessionState(host, "github:selected", {
              repo: target.repo,
              number: target.number,
            });
            setSessionState(host, "github:showDetail", true);
          } else {
            setSessionState(host, "linear:teamOverride", target.teamId);
            setSessionState(host, "linear:selected", {
              connectionId: target.connectionId,
              workspaceId: target.workspaceId,
              teamId: target.teamId,
              issueId: target.issueId,
            });
            setSessionState(host, "linear:showDetail", true);
          }
        }}
      >
        {workspace}
      </InlineIssueTabs>
    ) : (
      workspace
    );
  }
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
  const client = sessionValue(host, "query-client", () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 15_000,
          refetchOnWindowFocus: true,
        },
        mutations: { retry: false },
      },
    });
    seedPresentationCache(client, host);
    return client;
  });
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
