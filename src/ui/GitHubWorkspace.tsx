import {
  useGitHubAuthScope,
  useGitHubCall,
  githubSessionKey,
  isGitHubAuthScope,
} from "./github-auth";
import { AsyncState } from "./AsyncState";
import {
  WorkspaceLayout,
  WorkspaceHeader,
  WorkspaceIssueList,
} from "./WorkspaceLayout";
import { RefreshFailure } from "./RefreshFailure";
import { GitHubDetail } from "./GitHubDetail";
import { StateIcon, ShortDate } from "./GitHubIssueMeta";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCw,
  Filter,
  Plus,
  MagnifyingGlassSearch,
} from "@openai/apps-sdk-ui/components/Icon";
import { selectionIssueData, isTextSelectionClick } from "./selection-context";
import { SingleSelect, type SingleSelectHandle } from "./SingleSelect";
import {
  DraftStatus,
  draftController,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import { GitHubCreateIssue } from "./GitHubCreateIssue";
import { InlineSummaryCard } from "./InlineSummaryCard";
import { GitHubInlineProperties } from "./InlineIssueProperties";
import {
  InlineSkeleton,
  IssueDetailSkeleton,
  IssueListSkeleton,
  WorkspaceSkeleton,
} from "./LoadingSkeleton";
import { useGitHubSettings } from "./useGitHubSettings";
import type { DraftKey, Settings } from "../shared/state";
import { ProjectScopePicker } from "./ProjectScopePicker";
import { BulkActions, type BulkIssue } from "./BulkActions";
import { repoSchema } from "../shared/contracts";
import {
  githubIssueUrl,
  githubRepositoryUrl,
  isIssueUrlInput,
} from "../shared/issue-url";
import type {
  ArcoHost,
  AccountIssuesInput,
  Connection,
  IssueDetail,
  IssueRef,
  IssueSummary,
  RepositoryPage,
} from "../shared/contracts";
import { DisclosureSummary } from "./DisclosureSummary";
import type { LaunchContext } from "../shared/launch";
import { resolveContentDraft } from "./content-drafts";
import { toggleMarkdownTask } from "./markdown-tasks";
import type { Draft } from "../shared/state";
import {
  useCommandSession,
  useSessionRef,
  useSessionState,
} from "./session-state";
import { useHostView } from "./HostProvider";
import { Notice, type NoticeValue } from "./Notice";
import {
  githubIssueKey,
  useGitHubIssueList,
  useGitHubIssue,
  useGitHubMetadata,
  useGitHubIssueMutation,
} from "./github-queries";
import { useListScroll, useListKeyboard } from "./useListInteraction";
import { useIssueListContinuation } from "./useIssueListContinuation";
import { useDebouncedSearch } from "./useDebouncedSearch";

const refKey = (issue: IssueRef) => `${issue.repo}#${issue.number}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const accountViews = [
  { value: "assigned", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
  { value: "mentioned", label: "Mentioned me" },
  { value: "all", label: "All account repositories" },
] as const;

function IssueRow({
  issue,
  selected,
  onSelect,
  showRepository = false,
}: {
  issue: IssueSummary;
  selected: boolean;
  onSelect: () => void;
  showRepository?: boolean;
}) {
  return (
    <button
      className={`issue-row ${selected ? "selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      data-arco-issue={selectionIssueData(issue)}
      onClick={(event) => {
        if (event.detail > 0 && isTextSelectionClick(event.currentTarget))
          return;
        onSelect();
      }}
    >
      <StateIcon state={issue.state} />
      <span className="row-content">
        <span className="row-title">{issue.title}</span>
        <span className="row-meta">
          <span>
            {showRepository ? `${issue.repo} ` : ""}#{issue.number} ·{" "}
            {issue.author}
          </span>
          <ShortDate date={issue.updatedAt} />
        </span>
        {issue.labels.length > 0 && (
          <span className="row-labels">
            {issue.labels.slice(0, 2).map((label) => (
              <span key={label.id}>{label.name}</span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

export function GitHubWorkspace({
  host,
  launch,
  onSourceChange,
}: {
  host: ArcoHost;
  launch: LaunchContext;
  onSourceChange: (source: "github" | "linear") => void;
}) {
  const authScope = useGitHubAuthScope();
  const call = useGitHubCall(host);
  const projectView = launch.view === "project";
  const { mode, sharedIssue } = useHostView();
  const target = launch.target?.source === "github" ? launch.target : null;
  const targetedInline = Boolean(target) && mode === "inline";
  const [restoredShared] = useState(() => host.sharedIssue());
  const restoredGithub =
    restoredShared?.source === "github" ? restoredShared : null;
  const [restoreSharedView] = useState(
    () => !projectView || host.mode() === "inline",
  );
  const restoredSelection =
    restoreSharedView ||
    restoredGithub?.repo.toLowerCase() === launch.repo?.toLowerCase()
      ? restoredGithub
      : null;
  const queryClient = useQueryClient();
  const persistence = useDraftPersistence(host);
  const loadDraft = persistence.load;
  const settings = useGitHubSettings(
    host,
    projectView ? { key: launch.projectKey } : undefined,
  );
  const [repoOverride, setRepoOverride] = useSessionState<string | null>(
    host,
    githubSessionKey(authScope, "github:repoOverride"),
    target?.repo ??
      (restoreSharedView ? (restoredGithub?.repo ?? launch.repo) : launch.repo),
  );
  const [accountViewOverride, setAccountViewOverride] = useSessionState<
    AccountIssuesInput["filter"] | null
  >(host, githubSessionKey(authScope, "github:accountViewOverride"), null);
  const [registeredRepos, setRegisteredRepos] = useSessionState<string[]>(
    host,
    githubSessionKey(authScope, "github:registeredRepos"),
    [],
  );
  const previousSelection = useSessionRef(
    host,
    githubSessionKey(authScope, "github:previousSelection"),
    new Map<string, number>(),
  );
  const [bulkIssues, setBulkIssues] = useSessionState<BulkIssue[]>(
    host,
    githubSessionKey(authScope, "github:bulkIssues"),
    [],
  );
  const bulkIssueKeys = useMemo(
    () => new Set(bulkIssues.map(refKey)),
    [bulkIssues],
  );
  const [bulkBusy, setBulkBusy] = useSessionState(
    host,
    githubSessionKey(authScope, "github:bulkBusy"),
    false,
  );
  const [repoError, setRepoError] = useSessionState(
    host,
    githubSessionKey(authScope, "github:repoError"),
    "",
  );
  const [searchEntry, setSearchEntry] = useSessionState<string | null>(
    host,
    githubSessionKey(authScope, "github:searchEntry"),
    null,
  );
  const [searchError, setSearchError] = useSessionState(
    host,
    githubSessionKey(authScope, "github:searchError"),
    "",
  );
  const [urlBusy, setUrlBusy] = useSessionState(
    host,
    githubSessionKey(authScope, "github:urlBusy"),
    false,
  );
  const urlRequest = useRef(0);
  useEffect(
    () => () => {
      urlRequest.current += 1;
      setUrlBusy(false);
    },
    [setUrlBusy],
  );
  const [localFilters, setLocalFilters] = useSessionState<
    Settings["githubFilters"]
  >(host, githubSessionKey(authScope, "github:localFilters"), {});
  const filtersRef = useSessionRef<Settings["githubFilters"]>(
    host,
    githubSessionKey(authScope, "github:filtersRef"),
    {},
  );
  const [selected, setSelected] = useSessionState<IssueRef | null>(
    host,
    githubSessionKey(authScope, "github:selected"),
    target ?? restoredSelection,
  );
  const [showDetail, setShowDetail] = useSessionState(
    host,
    githubSessionKey(authScope, "github:showDetail"),
    Boolean(target),
  );
  const shared = sharedIssue?.source === "github" ? sharedIssue : null;
  const [createOpen, setCreateOpen] = useSessionState(
    host,
    githubSessionKey(authScope, "github:createOpen"),
    false,
  );
  const [notice, setNotice] = useSessionState<NoticeValue | null>(
    host,
    githubSessionKey(authScope, "github:notice"),
    null,
  );
  const [hostBusy, setHostBusy] = useSessionState(
    host,
    githubSessionKey(authScope, "github:hostBusy"),
    false,
  );
  const hostLock = useSessionRef(
    host,
    githubSessionKey(authScope, "github:hostLock"),
    false,
  );
  const commands = useCommandSession(host, "github", authScope);
  const searchRef = useRef<HTMLInputElement>(null);
  const scopeSelectRef = useRef<SingleSelectHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const connection = useQuery({
    queryKey: ["connection"],
    queryFn: () => host.call<Connection>("arco_connection", {}),
  });
  const repo =
    repoOverride ??
    (projectView && launch.projectKey
      ? settings.query.data?.settings.projectGithubRepos[launch.projectKey]
      : "") ??
    "";
  const connectionIdentity = `${connection.data?.mode ?? "pending"}:${connection.data?.account ?? "disconnected"}:${authScope}`;
  const accountView =
    accountViewOverride ??
    settings.query.data?.settings.githubAccountFilter.filter ??
    "assigned";
  const accountViewLabel = accountViews.find(
    (view) => view.value === accountView,
  )!.label;
  const filterKey = `${connectionIdentity}:${repo || `@account:${accountView}`}`;
  const repositoryDiscovery = useInfiniteQuery({
    queryKey: [
      "github-repositories",
      connection.data?.mode,
      connection.data?.account,
      connection.data?.connected,
      authScope,
    ],
    queryFn: ({ pageParam }) =>
      call<RepositoryPage>("arco_repositories", { page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: connection.data?.connected === true && !targetedInline,
  });
  const filter = localFilters[filterKey] ??
    (repo
      ? settings.query.data?.settings.githubFilters[repo]
      : {
          query: "",
          ...(settings.query.data?.settings.githubAccountFilter ?? {
            state: "open" as const,
            sort: "updated" as const,
            order: "desc" as const,
          }),
        }) ?? {
      query: "",
      state: "open" as const,
      sort: "updated" as const,
      order: "desc" as const,
    };
  const search = useDebouncedSearch(filter.query, filterKey);
  const updateFilter = (patch: Partial<Settings["githubFilters"][string]>) => {
    const next = { ...(filtersRef.current[filterKey] ?? filter), ...patch };
    filtersRef.current = { ...filtersRef.current, [filterKey]: next };
    setLocalFilters(filtersRef.current);
    if (repo) {
      settings.saveFilter(repo, next);
      return;
    }
    settings.saveAccountFilter({
      filter: accountView,
      state: next.state,
      sort: next.sort,
      order: next.order,
    });
  };
  const setQuery = (query: string) => updateFilter({ query });
  const repositoryInfo = useMemo(() => {
    const byName = new Map<string, RepositoryPage["repositories"][number]>();
    for (const page of repositoryDiscovery.data?.pages ?? [])
      for (const repository of page.repositories)
        if (!byName.has(repository.repo))
          byName.set(repository.repo, repository);
    return byName;
  }, [repositoryDiscovery.data]);
  const repositories = [
    ...new Set(
      [
        repo,
        ...launch.candidates,
        ...(settings.query.data?.settings.githubRepos ?? []),
        ...registeredRepos,
        ...repositoryInfo.keys(),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const changeRepo = (
    nextRepo: string,
    nextAccountView?: AccountIssuesInput["filter"],
  ) => {
    if (commands.lock.current || bulkBusy) return;
    urlRequest.current += 1;
    setUrlBusy(false);
    setSearchEntry(null);
    setSearchError("");
    rememberListScroll();
    if (selected) previousSelection.current.set(selected.repo, selected.number);
    setRepoOverride(nextRepo);
    if (nextRepo) settings.register(nextRepo, registeredRepos);
    else {
      if (nextAccountView) setAccountViewOverride(nextAccountView);
      settings.setAccountScope(nextAccountView);
    }
    const previous = previousSelection.current.get(nextRepo);
    setSelected(previous ? { repo: nextRepo, number: previous } : null);
    setShowDetail(false);
  };
  const listScope = `${connectionIdentity}|${repo || `@account:${accountView}`}|${search.query}|${filter.state}|${filter.sort}|${filter.order}`;
  const issues = useGitHubIssueList(host, {
    connection: connection.data,
    repo,
    accountView,
    query: search.query,
    state: filter.state,
    sort: filter.sort,
    order: filter.order,
    enabled:
      !targetedInline &&
      connection.data?.connected === true &&
      (!projectView || Boolean(repo)) &&
      !settings.query.isPending,
  });
  const rows = useMemo(
    () =>
      connection.data?.connected
        ? (issues.data?.pages.flatMap((page) => page.issues) ?? [])
        : [],
    [issues.data, connection.data?.connected],
  );
  const loadMoreIssues = useIssueListContinuation({
    listRef,
    scope: listScope,
    enabled: mode === "fullscreen" && connection.data?.connected === true,
    hasNextPage: issues.hasNextPage,
    isFetching: issues.isFetching,
    isError: issues.isError,
    pageCount: issues.data?.pages.length ?? 0,
    loadNext: () => issues.fetchNextPage({ cancelRefetch: false }),
  });
  useEffect(() => {
    if (!selected && rows[0])
      setSelected({ repo: rows[0].repo, number: rows[0].number });
  }, [selected, rows, setSelected]);
  const activeRef = selected ?? rows[0] ?? null;
  const activeRepo = activeRef?.repo;
  const activeNumber = activeRef?.number;
  const activeDraftKey = useMemo<DraftKey | null>(
    () =>
      activeRepo && activeNumber
        ? { source: "github", repo: activeRepo, issue: String(activeNumber) }
        : null,
    [activeRepo, activeNumber],
  );
  useEffect(() => {
    if (activeDraftKey) void loadDraft(activeDraftKey);
  }, [activeDraftKey, loadDraft]);

  const detail = useGitHubIssue(
    host,
    activeRef,
    !targetedInline &&
      Boolean(activeRef) &&
      connection.data?.connected === true,
  );
  const sharedDetail = useGitHubIssue(
    host,
    shared,
    !targetedInline && Boolean(shared) && connection.data?.connected === true,
  );
  const targetDetail = useGitHubIssue(
    host,
    target,
    targetedInline && connection.data?.connected === true,
  );
  const metadataRepo = targetedInline
    ? target!.repo
    : mode === "inline" && shared
      ? (sharedDetail.data?.repo ?? shared.repo)
      : (activeRef?.repo ?? repo);
  const metadata = useGitHubMetadata(
    host,
    metadataRepo,
    Boolean(metadataRepo) && connection.data?.connected === true,
  );
  const mutation = useGitHubIssueMutation(host);

  const rememberListScroll = useListScroll({
    host,
    sessionKey: "github:scrollPositions",
    listRef,
    scope: listScope,
    mode,
    ready: issues.isSuccess,
  });
  useListKeyboard({
    rows,
    activeKey: activeRef ? refKey(activeRef) : null,
    keyForRow: refKey,
    onSelect: (issue) => {
      setSelected({ repo: issue.repo, number: issue.number });
      setShowDetail(true);
    },
    onClose: () => setShowDetail(false),
    searchRef,
  });

  const save = async (
    name: string,
    args: Record<string, unknown>,
    after?: (result: IssueDetail) => void,
  ) => {
    if (commands.lock.current) return;
    commands.lock.current = true;
    commands.setBusy(true);
    setNotice(null);
    const operationKey = JSON.stringify([name, args]);
    const operationId =
      commands.requests.get(operationKey) ?? crypto.randomUUID();
    commands.requests.set(operationKey, operationId);
    try {
      const result = await mutation.mutateAsync({
        name,
        args: { ...args, requestId: operationId },
      });
      if (isGitHubAuthScope(queryClient, authScope)) {
        after?.(result);
      }
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
      await queryClient.invalidateQueries({ queryKey: ["issue"] });
      await queryClient.invalidateQueries({ queryKey: ["issues"] });
    } finally {
      commands.lock.current = false;
      commands.setBusy(false);
    }
  };
  const hostAction = async (action: () => Promise<void>) => {
    if (!isGitHubAuthScope(queryClient, authScope)) return;
    if (hostLock.current) return;
    hostLock.current = true;
    setHostBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
    } finally {
      hostLock.current = false;
      setHostBusy(false);
    }
  };
  const switchMode = (next: "inline" | "fullscreen") =>
    hostAction(async () => {
      rememberListScroll();
      await host.display(next);
    });
  const updateDraft = (issue: IssueDetail, patch: Partial<Draft>) => {
    const current = resolveContentDraft(
      issue,
      persistence.value({
        source: "github",
        repo: issue.repo,
        issue: String(issue.number),
      }),
    );
    const startsContentEdit =
      ("title" in patch || "body" in patch) && !current.baseUpdatedAt;
    persistence.schedule(
      { source: "github", repo: issue.repo, issue: String(issue.number) },
      {
        ...current,
        ...(startsContentEdit
          ? {
              baseUpdatedAt: issue.updatedAt,
              baseTitle: issue.title,
              baseBody: issue.body,
            }
          : {}),
        ...patch,
      },
    );
  };
  const openIssueUrl = async (
    value: string,
    entry: "search" | "repo" = "search",
  ) => {
    const request = ++urlRequest.current;
    setUrlBusy(true);
    setSearchError("");
    setRepoError("");
    try {
      const target = githubIssueUrl(value);
      if (commands.lock.current || bulkBusy)
        throw new Error(
          "Wait for the current change before opening another issue.",
        );
      const issue = await call<IssueDetail>("arco_get_issue", target);
      if (request !== urlRequest.current) return;
      if (
        issue.repo.toLowerCase() !== target.repo.toLowerCase() ||
        issue.number !== target.number
      )
        throw new Error(
          "GitHub returned a different issue than the pasted URL.",
        );
      const resolved = { repo: issue.repo, number: issue.number };
      queryClient.setQueryData(githubIssueKey(resolved, authScope), issue);
      changeRepo(resolved.repo);
      setSelected(resolved);
      setShowDetail(true);
    } catch (error) {
      if (request !== urlRequest.current) return;
      if (entry === "repo") setRepoError(errorText(error));
      else setSearchError(errorText(error));
    } finally {
      if (request === urlRequest.current) setUrlBusy(false);
    }
  };
  const submitRepo = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (commands.busy) return;
    const entered = String(
      new FormData(event.currentTarget).get("repo") ?? "",
    ).trim();
    let value = entered;
    if (isIssueUrlInput(entered)) {
      try {
        value = githubRepositoryUrl(entered);
      } catch {
        void openIssueUrl(entered, "repo");
        return;
      }
    }
    if (!repoSchema.safeParse(value).success) {
      setRepoError("Enter owner/repository or a github.com repository URL.");
      return;
    }
    setRepoError("");
    setRegisteredRepos((previous) => [...new Set([...previous, value])]);
    changeRepo(value);
  };
  const selectedDetail = detail.data;
  const initialIssuesLoading =
    issues.isPending &&
    connection.data?.connected === true &&
    (!projectView || Boolean(repo));
  const detailLoading =
    !selectedDetail &&
    ((detail.isPending && Boolean(activeRef)) ||
      (initialIssuesLoading && !activeRef));
  const retainedIssue = target
    ? targetDetail.data
    : (sharedDetail.data ?? (!shared ? selectedDetail : undefined));
  const retainedShared = Boolean(
    shared &&
    (!target ||
      (shared.repo.toLowerCase() === target.repo.toLowerCase() &&
        shared.number === target.number)),
  );
  const toggleRetainedTask = async (line: number, checked: boolean) => {
    if (!retainedIssue) return;
    const body = toggleMarkdownTask(retainedIssue.body, line, checked);
    if (body === retainedIssue.body) return;
    const key: DraftKey = {
      source: "github",
      repo: retainedIssue.repo,
      issue: String(retainedIssue.number),
    };
    const controller = draftController(host);
    const draft = resolveContentDraft(
      retainedIssue,
      await controller.load(key),
    );
    const status = controller.get()[draftStorageId(key)];
    if (
      status?.state === "error" ||
      status?.state === "conflict" ||
      status?.state === "resolving"
    ) {
      setNotice({
        kind: "error",
        text: "Open details to review the local draft before changing checklist items.",
      });
      return;
    }
    if (
      draft.title !== retainedIssue.title ||
      draft.body !== retainedIssue.body
    ) {
      setNotice({
        kind: "info",
        text: "Open details to save or discard your title or description draft before changing checklist items.",
      });
      return;
    }
    void save("arco_update_issue", {
      repo: retainedIssue.repo,
      number: retainedIssue.number,
      expectedUpdatedAt: retainedIssue.updatedAt,
      patch: { body },
    });
  };
  const compactFailure = targetedInline
    ? (targetDetail.error ?? connection.error ?? settings.query.error)
    : (sharedDetail.error ??
      detail.error ??
      connection.error ??
      settings.query.error ??
      issues.error);
  const compactError = compactFailure ? errorText(compactFailure) : null;
  const compactReady =
    connection.data?.connected === true && settings.query.isSuccess;
  const emptyIssueList =
    compactReady &&
    !shared &&
    !activeRef &&
    issues.isSuccess &&
    rows.length === 0;
  const openRetainedDetails = () => {
    if (retainedIssue) {
      if (retainedIssue.repo !== repo) {
        if (target) setRepoOverride(retainedIssue.repo);
        else changeRepo(retainedIssue.repo);
      }
      setSelected({ repo: retainedIssue.repo, number: retainedIssue.number });
      setShowDetail(true);
    }
    void switchMode("fullscreen");
  };
  const chooseRepository = async () => {
    setShowDetail(false);
    if (mode !== "fullscreen") await switchMode("fullscreen");
    requestAnimationFrame(() => scopeSelectRef.current?.open());
  };

  const detailFeedback = (
    <>
      {connection.data?.mode === "fixture" && (
        <div className="fixture-banner">
          <span>LOCAL FIXTURE</span>
          Testing with fictional issues. Changes stay in the local fixture.
        </div>
      )}
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {selectedDetail && (
        <RefreshFailure
          error={detail.error}
          pending={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      )}
      {selectedDetail && activeDraftKey && (
        <DraftStatus
          status={persistence.statuses[draftStorageId(activeDraftKey)]}
          onRetry={() =>
            persistence.retry(
              activeDraftKey,
              persistence.value(activeDraftKey!) ??
                resolveContentDraft(selectedDetail),
            )
          }
          onResolve={(choice) => {
            void persistence.resolve(
              activeDraftKey,
              choice,
              persistence.value(activeDraftKey!) ??
                resolveContentDraft(selectedDetail),
            );
          }}
        />
      )}
    </>
  );

  if (settings.query.isPending) return <WorkspaceSkeleton mode={mode} />;

  if (connection.isPending) return <WorkspaceSkeleton mode={mode} />;

  if (
    mode === "inline" &&
    !retainedIssue &&
    !compactError &&
    connection.data?.connected &&
    (targetedInline
      ? targetDetail.isPending
      : initialIssuesLoading ||
        (detail.isPending && Boolean(activeRef)) ||
        (sharedDetail.isPending && Boolean(shared)))
  )
    return <InlineSkeleton />;

  if (mode === "inline" && retainedIssue)
    return (
      <InlineSummaryCard
        host={host}
        issue={retainedIssue}
        busy={commands.busy || hostBusy}
        onOpen={openRetainedDetails}
        onOpenLink={(url) => void hostAction(() => host.openLink(url))}
        onToggleTask={(line, checked) => void toggleRetainedTask(line, checked)}
        properties={
          <GitHubInlineProperties
            issue={retainedIssue}
            currentUser={connection.data?.account}
            metadata={metadata.data}
            metadataError={metadata.error}
            busy={commands.busy || hostBusy}
            onRetry={() => void metadata.refetch()}
            onSave={(name, args) => void save(name, args)}
          />
        }
        notice={notice}
        footer={
          connection.data?.mode === "fixture"
            ? "Local fixture · No GitHub writes"
            : undefined
        }
      />
    );

  if (mode === "inline")
    return (
      <main
        className="arco compact-mode inline-mode"
        data-arco-github-auth-generation={authScope}
        data-arco-issue={
          retainedIssue ? selectionIssueData(retainedIssue) : undefined
        }
      >
        <div className="compact-top">
          <strong className="wordmark">Arco</strong>
          <span className="muted">
            {retainedShared ? "Shared issue" : "Browsing"}
          </span>
          <button
            className="icon-button"
            aria-label="Expand"
            onClick={openRetainedDetails}
          >
            ↗
          </button>
        </div>
        {compactError ? (
          <p className="inline-error" role="alert">
            {compactError}
          </p>
        ) : connection.data && !connection.data.connected ? (
          <p className="muted">{connection.data.message}</p>
        ) : emptyIssueList ? (
          <>
            <h1>
              {issues.hasNextPage
                ? "No issues on this page"
                : "No matching issues"}
            </h1>
            <p className="compact-summary">
              {`${repo || accountViewLabel} · ${filter.state === "all" ? "All states" : filter.state === "closed" ? "Closed" : "Open"}${repo && filter.query ? ` · ${filter.query}` : ""}`}
            </p>
            {issues.hasNextPage ? (
              <Button
                color="secondary"
                variant="outline"
                size="sm"
                loading={issues.isFetchingNextPage}
                disabled={issues.isFetching}
                onClick={loadMoreIssues}
              >
                Load more
              </Button>
            ) : !repo && accountView === "assigned" ? (
              <div className="empty-scope-actions">
                <Button
                  color="secondary"
                  variant="outline"
                  size="sm"
                  onClick={() => changeRepo("", "created")}
                >
                  View issues created by me
                </Button>
                <button
                  className="text-button"
                  disabled={hostBusy}
                  onClick={() => void chooseRepository()}
                >
                  Choose a repository
                </button>
              </div>
            ) : (
              <Button
                color="secondary"
                variant="outline"
                size="sm"
                disabled={hostBusy}
                onClick={() => void switchMode("fullscreen")}
              >
                Open issue list
              </Button>
            )}
          </>
        ) : (
          <p className="muted">Select an issue to view its details.</p>
        )}
        {connection.data?.mode === "fixture" && (
          <span className="fixture-tag">Local fixture · No GitHub writes</span>
        )}
        {notice && (
          <div
            role={notice.kind === "error" ? "alert" : "status"}
            className={`notice ${notice.kind}`}
          >
            {notice.text}
          </div>
        )}
      </main>
    );

  return (
    <WorkspaceLayout
      source="github"
      detailOpen={showDetail}
      viewer={projectView ? "project" : "personal"}
    >
      <aside className="issue-sidebar" aria-label="Issues">
        <WorkspaceHeader
          source="github"
          onSourceChange={(next) => {
            rememberListScroll();
            onSourceChange(next);
          }}
          onCreate={() => {
            if (repo) setCreateOpen(true);
            else scopeSelectRef.current?.open();
          }}
          createDisabled={!connection.data?.connected}
          createLabel="Create issue"
          createTitle={
            repo ? "Create issue" : "Choose a repository to create an issue"
          }
        />
        <div className="scope-picker">
          <h2 className="viewer-title">
            {projectView
              ? launch.projectName
                ? `${launch.projectName} issues`
                : "Issues for this chat"
              : repo
                ? "Repository issues"
                : "My issues"}
          </h2>
          <div
            className="scope-control"
            title={
              projectView
                ? "Repository selection is saved for this chat."
                : repo
                  ? "Issues in the selected repository."
                  : "Issues across your account repositories."
            }
          >
            <SingleSelect
              ref={scopeSelectRef}
              id="github-scope"
              className="scope-select"
              label="GitHub view"
              searchPlaceholder={
                projectView
                  ? "Search repositories…"
                  : "Search views or repositories…"
              }
              value={repo || (projectView ? "" : `account:${accountView}`)}
              disabled={commands.busy || bulkBusy}
              onChange={(value) => {
                const view = accountViews.find(
                  (entry) => `account:${entry.value}` === value,
                );
                if (view) changeRepo("", view.value);
                else changeRepo(value);
              }}
              options={[
                ...(!projectView
                  ? [
                      {
                        label: "Across repositories",
                        options: accountViews.map((view) => ({
                          value: `account:${view.value}`,
                          label: view.label,
                        })),
                      },
                    ]
                  : [
                      {
                        label: "Repository for this chat",
                        options: [
                          {
                            value: "",
                            label: "Choose repository",
                            disabled: true,
                          },
                        ],
                      },
                    ]),
                ...(repositories.length > 0 ||
                (repositoryDiscovery.isPending && connection.data?.connected)
                  ? [
                      {
                        label: "Repositories",
                        options: [
                          ...repositories.map((value) => {
                            const info = repositoryInfo.get(value);
                            return {
                              value,
                              label: `${value}${info?.archived ? " (archived)" : ""}${info?.issuesEnabled === false ? " (issues disabled)" : ""}`,
                              disabled: info?.issuesEnabled === false,
                            };
                          }),
                          ...(repositoryDiscovery.isPending &&
                          connection.data?.connected
                            ? [
                                {
                                  value: "loading:repositories",
                                  label: "Loading repositories…",
                                  disabled: true,
                                },
                              ]
                            : []),
                        ],
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <details className="repo-add repository-management">
            <DisclosureSummary>Manage repositories</DisclosureSummary>
            <div className="scope-actions">
              {repositoryDiscovery.hasNextPage && (
                <button
                  className="text-button"
                  disabled={repositoryDiscovery.isFetchingNextPage}
                  onClick={() => void repositoryDiscovery.fetchNextPage()}
                >
                  {repositoryDiscovery.isFetchingNextPage
                    ? "Loading…"
                    : "Load more repositories"}
                </button>
              )}
            </div>
            <form
              className="repo-form"
              key={`repo-form:${repo}`}
              onSubmit={submitRepo}
            >
              <label htmlFor="repo-input">Repository or URL</label>
              <div className="repo-control">
                <input
                  id="repo-input"
                  name="repo"
                  disabled={commands.busy}
                  defaultValue=""
                  placeholder="owner/repository"
                  autoComplete="off"
                  aria-describedby={repoError ? "repo-error" : undefined}
                />
                <button
                  className="icon-button"
                  aria-label="Open repository"
                  type="submit"
                >
                  <Plus aria-hidden="true" />
                </button>
              </div>
            </form>
            {repoError && (
              <p id="repo-error" role="alert" className="inline-error">
                {repoError}
              </p>
            )}
            {repositoryDiscovery.isError && (
              <p className="inline-error" role="alert">
                Could not load repositories.{" "}
                <button
                  className="text-button"
                  onClick={() => void repositoryDiscovery.refetch()}
                >
                  Retry
                </button>
              </p>
            )}
          </details>
        </div>
        {(settings.query.isError || settings.error) && (
          <div className="settings-error inline-error" role="alert">
            Could not save display settings locally:{" "}
            {settings.error || settings.query.error?.message}
            <button
              className="text-button"
              disabled={settings.pending}
              onClick={settings.retry}
            >
              Retry save
            </button>
          </div>
        )}
        {(!projectView || repo) && (
          <div className="search-control" aria-busy={urlBusy}>
            <MagnifyingGlassSearch aria-hidden="true" />
            <input
              ref={searchRef}
              aria-label="Search issues"
              value={searchEntry ?? (repo ? filter.query : "")}
              disabled={!connection.data?.connected}
              onCompositionStart={search.onCompositionStart}
              onCompositionEnd={search.onCompositionEnd}
              aria-describedby={searchError ? "github-search-error" : undefined}
              onChange={(event) => {
                urlRequest.current += 1;
                setUrlBusy(false);
                setSearchError("");
                rememberListScroll();
                const value = event.target.value;
                if (isIssueUrlInput(value) || !repo) {
                  setSearchEntry(value);
                  return;
                }
                setSearchEntry(null);
                setQuery(value);
              }}
              onPaste={(event) => {
                const value = event.clipboardData.getData("text").trim();
                if (isIssueUrlInput(value)) {
                  event.preventDefault();
                  setSearchEntry(value);
                  void openIssueUrl(value);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing)
                  return;
                const value = event.currentTarget.value.trim();
                if (isIssueUrlInput(value)) {
                  event.preventDefault();
                  void openIssueUrl(value);
                } else if (!repo && value)
                  setSearchError(
                    "Choose a repository to search titles, or paste a GitHub issue URL.",
                  );
              }}
              placeholder={
                repo
                  ? "Search or paste issue URL…"
                  : "Paste a GitHub issue URL…"
              }
            />
            {repo && <kbd>/</kbd>}
          </div>
        )}
        {searchError && (
          <p className="inline-error" id="github-search-error" role="alert">
            {searchError}
          </p>
        )}
        {(!projectView || repo) && (
          <div className="list-filter">
            <div className="segmented" aria-label="Issue state">
              {(["open", "closed", "all"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter.state === value}
                  onClick={() => {
                    rememberListScroll();
                    updateFilter({ state: value });
                  }}
                >
                  {value === "open"
                    ? "Open"
                    : value === "closed"
                      ? "Closed"
                      : "All"}
                </button>
              ))}
            </div>
            <button
              className="icon-button"
              aria-label="Refresh"
              title="Refresh"
              disabled={issues.isFetching}
              onClick={() => void queryClient.invalidateQueries()}
            >
              <ArrowRotateCw aria-hidden="true" />
            </button>
          </div>
        )}
        {(!projectView || repo) && (
          <details className="search-options sidebar-filters">
            <DisclosureSummary>
              <Filter aria-hidden="true" />
              Filters
            </DisclosureSummary>
            <label>
              Sort by
              <SingleSelect
                label="Sort issues"
                value={filter.sort}
                onChange={(value) => {
                  rememberListScroll();
                  updateFilter({
                    sort: value as "updated" | "created" | "comments",
                  });
                }}
                options={[
                  { value: "updated", label: "Last updated" },
                  { value: "created", label: "Created" },
                  { value: "comments", label: "Comments" },
                ]}
              />
            </label>
            <label>
              Direction
              <SingleSelect
                label="Sort direction"
                value={filter.order}
                onChange={(value) => {
                  rememberListScroll();
                  updateFilter({ order: value === "asc" ? "asc" : "desc" });
                }}
                options={[
                  { value: "desc", label: "Descending" },
                  { value: "asc", label: "Ascending" },
                ]}
              />
            </label>
            {repo ? (
              <ProjectScopePicker
                key={`project-scope:${repo}`}
                host={host}
                repo={repo}
                value={/(?:^|\s)project:([^\s]+)/.exec(filter.query)?.[1] ?? ""}
                onChange={(value) => {
                  rememberListScroll();
                  const rest = filter.query
                    .replace(/(?:^|\s)project:[^\s]+/g, "")
                    .trim();
                  setQuery(`${rest}${value ? ` project:${value}` : ""}`.trim());
                }}
              />
            ) : null}
            <p>
              {repo
                ? "Search supports label:bug, assignee:username, and project:owner/number."
                : "Choose a repository to search or filter by Project."}
            </p>
            {!repo && accountView === "all" && (
              <p>
                Includes repositories you own or collaborate on, including
                organization repositories.
              </p>
            )}
          </details>
        )}
        <div className="list-caption">
          <span>
            {issues.isFetching && !issues.isPending ? "Refreshing…" : null}
          </span>
          <span>
            {rows.length} {rows.length === 1 ? "issue" : "issues"}
            {issues.hasNextPage ? " loaded" : ""}
          </span>
        </div>
        <WorkspaceIssueList
          ref={listRef}
          onScroll={rememberListScroll}
          busy={issues.isFetching}
          refreshing={issues.isFetching && !issues.isPending}
          bulkActions={
            bulkIssues.length > 0 && (
              <BulkActions
                identity={connectionIdentity}
                host={host}
                issues={bulkIssues}
                onClear={() => setBulkIssues([])}
                onBusy={setBulkBusy}
              />
            )
          }
        >
          {projectView && !repo && connection.data?.connected && (
            <div className="list-message project-repository-empty">
              <strong>Choose a repository</strong>
              <p>
                {launch.reason === "ambiguous"
                  ? "More than one GitHub repository is connected to this project. Choose the one to view."
                  : "Choose the repository to view in this chat. Arco will remember your choice here."}
              </p>
              <Button
                color="secondary"
                variant="outline"
                size="sm"
                onClick={() => scopeSelectRef.current?.open()}
              >
                Choose repository
              </Button>
            </div>
          )}
          {initialIssuesLoading && <IssueListSkeleton />}
          {connection.isError && (
            <p className="list-message inline-error" role="alert">
              {errorText(connection.error)}
            </p>
          )}
          {connection.data && !connection.data.connected && (
            <div className="list-message connection-empty">
              <strong>Connect to GitHub</strong>
              <p>{connection.data.message}</p>
              <p>
                Arco uses GitHub CLI authentication. Refresh after connecting.
              </p>
              <Button
                color="secondary"
                variant="outline"
                size="sm"
                onClick={() => void connection.refetch()}
              >
                Check connection
              </Button>
            </div>
          )}
          {issues.isError && !issues.isFetchNextPageError && (
            <AsyncState kind="error" className="list-message inline-error">
              {errorText(issues.error)}
              <button
                className="text-button"
                onClick={() => void issues.refetch()}
              >
                Retry
              </button>
            </AsyncState>
          )}
          {rows.map((issue) => (
            <div className="selectable-row" key={refKey(issue)}>
              <input
                type="checkbox"
                aria-label={`Select ${issue.repo} #${issue.number} for bulk actions`}
                checked={bulkIssueKeys.has(refKey(issue))}
                disabled={bulkBusy}
                onChange={(event) =>
                  setBulkIssues((previous) =>
                    event.target.checked
                      ? [
                          ...previous,
                          {
                            repo: issue.repo,
                            number: issue.number,
                            title: issue.title,
                          },
                        ]
                      : previous.filter(
                          (value) => refKey(value) !== refKey(issue),
                        ),
                  )
                }
              />
              <IssueRow
                issue={issue}
                showRepository={!repo}
                selected={Boolean(
                  activeRef && refKey(issue) === refKey(activeRef),
                )}
                onSelect={() => {
                  setSelected({ repo: issue.repo, number: issue.number });
                  setShowDetail(true);
                }}
              />
            </div>
          ))}
          {issues.isSuccess && rows.length === 0 && (
            <div className="list-message account-empty">
              <p>
                {issues.hasNextPage
                  ? "No issues on this page. More results are available."
                  : repo
                    ? "No issues match these filters."
                    : `No matching issues in ${accountViewLabel}.`}
              </p>
              {!issues.hasNextPage && !repo && accountView === "assigned" && (
                <div className="empty-scope-actions">
                  <button
                    className="text-button"
                    onClick={() => changeRepo("", "created")}
                  >
                    View issues created by me
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void chooseRepository()}
                  >
                    Choose a repository
                  </button>
                </div>
              )}
            </div>
          )}
          {issues.hasNextPage && (
            <>
              {issues.isFetchNextPageError && (
                <p className="list-message inline-error" role="alert">
                  Could not load more issues: {errorText(issues.error)}
                </p>
              )}
              <button
                className="load-more"
                disabled={issues.isFetching}
                onClick={loadMoreIssues}
              >
                {issues.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </>
          )}
        </WorkspaceIssueList>
      </aside>
      <section
        className={`detail-pane${detail.isFetching && !detail.isPending ? " refreshing" : ""}`}
        aria-label="Issue details"
        aria-busy={detail.isFetching || detailLoading}
        data-arco-issue={
          selectedDetail ? selectionIssueData(selectedDetail) : undefined
        }
      >
        {!selectedDetail && detailFeedback}
        {detailLoading && <IssueDetailSkeleton />}
        {detail.isError && !selectedDetail && (
          <div className="empty-state" role="alert">
            <strong>Could not load this issue</strong>
            <p>{errorText(detail.error)}</p>
            <Button
              color="secondary"
              variant="outline"
              onClick={() => void detail.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
        {!activeRef && !detail.isError && !detailLoading && (
          <AsyncState kind="empty" className="empty-state">
            <span className="empty-icon">◉</span>
            <h1>Start a conversation with an issue</h1>
            <p>
              Select an issue to review its description and progress.
              <br />
              You can review the target before sharing it with a chat.
            </p>
            <span className="keyboard-hint">
              <kbd>/</kbd> Search <kbd>j</kbd> <kbd>k</kbd> Select
            </span>
          </AsyncState>
        )}
        {selectedDetail && (
          <GitHubDetail
            key={refKey(selectedDetail)}
            issue={selectedDetail}
            feedback={detailFeedback}
            onBack={() => setShowDetail(false)}
            onFullscreen={() => void switchMode("fullscreen")}
            draft={resolveContentDraft(
              selectedDetail,
              activeDraftKey ? persistence.value(activeDraftKey) : undefined,
            )}
            onDraft={(patch) => updateDraft(selectedDetail, patch)}
            metadata={metadata.data}
            metadataError={metadata.error}
            busy={commands.busy}
            save={save}
            host={host}
            hostBusy={hostBusy}
            hostAction={hostAction}
            shared={shared}
          />
        )}
      </section>
      <GitHubCreateIssue
        host={host}
        repo={repo}
        open={createOpen}
        busy={commands.busy}
        fixture={connection.data?.mode === "fixture"}
        notice={notice}
        save={save}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          setRepoOverride(result.repo);
          setSelected({ repo: result.repo, number: result.number });
          setShowDetail(true);
        }}
      />
    </WorkspaceLayout>
  );
}
