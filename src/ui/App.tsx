import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  replaceEqualDeep,
  type InfiniteData,
} from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCw,
  Filter,
  MagnifyingGlassSearch,
  Plus,
} from "@openai/apps-sdk-ui/components/Icon";
import {
  Edit,
  Expand,
  ExternalLink,
} from "@openai/apps-sdk-ui/components/Icon";
import { DetailToolbar, closeDetailUtility } from "./DetailToolbar";
import {
  SelectionShare,
  selectionIssueData,
  isTextSelectionClick,
} from "./SelectionShare";
import { MultiSelect } from "./MultiSelect";
import { SingleSelect, type SingleSelectHandle } from "./SingleSelect";
import { IssueMarkdown } from "./MarkdownContent";
import { toggleMarkdownTask } from "./markdown-tasks";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import { LinearWorkspace } from "./LinearWorkspace";
import { AnimatedDialogBackdrop } from "./AnimatedDialogBackdrop";
import {
  InlineSkeleton,
  IssueDetailSkeleton,
  IssueListSkeleton,
  WorkspaceSkeleton,
} from "./LoadingSkeleton";
import { useGitHubSettings } from "./useGitHubSettings";
import type { DraftKey, Draft as SavedDraft, Settings } from "../shared/state";
import { CommentActions, CopyValue, ReactionBar } from "./GitHubDiscussion";
import { LabelManager } from "./LabelManager";
import { GitHubProperties } from "./GitHubProperties";
import { ProjectScopePicker } from "./ProjectScopePicker";
import { GitHubRelations } from "./GitHubRelations";
import { TemplatePicker, type TemplateDraft } from "./TemplatePicker";
import { BulkActions, type BulkIssue } from "./BulkActions";
import { repoSchema } from "../shared/contracts";
import {
  githubIssueUrl,
  githubRepositoryUrl,
  isIssueUrlInput,
} from "../shared/issue-url";
import type {
  ArcoHost,
  AccountIssuePage,
  AccountIssuesInput,
  Connection,
  Comment,
  CommentPage,
  IssueDetail,
  IssuePage,
  IssueRef,
  IssueSummary,
  RepoMetadata,
  RepositoryPage,
} from "../shared/contracts";
import { DisclosureSummary } from "./DisclosureSummary";
import { personalLaunchContext, type LaunchContext } from "../shared/launch";

type Draft = {
  title: string;
  body: string;
  comment: string;
  baseUpdatedAt?: string;
  baseTitle?: string;
  baseBody?: string;
  // Retain earlier saved request text without exposing an Arco composer.
  promptText?: string;
};
export function resolveDraft(issue: IssueDetail, stored?: Draft): Draft {
  if (!stored) return { title: issue.title, body: issue.body, comment: "" };
  const titleChanged =
    Boolean(stored.baseUpdatedAt) && stored.title !== stored.baseTitle;
  const bodyChanged =
    Boolean(stored.baseUpdatedAt) && stored.body !== stored.baseBody;
  if (
    (!titleChanged && !bodyChanged) ||
    (stored.title === issue.title && stored.body === issue.body)
  )
    return {
      ...stored,
      title: issue.title,
      body: issue.body,
      baseUpdatedAt: undefined,
      baseTitle: undefined,
      baseBody: undefined,
    };
  return {
    ...stored,
    title: titleChanged ? stored.title : issue.title,
    body: bodyChanged ? stored.body : issue.body,
    baseTitle: titleChanged ? stored.baseTitle : issue.title,
    baseBody: bodyChanged ? stored.baseBody : issue.body,
  };
}

export function draftConflict(issue: IssueDetail, draft: Draft): boolean {
  return (
    Boolean(draft.baseUpdatedAt) &&
    ((draft.title !== draft.baseTitle &&
      issue.title !== draft.baseTitle &&
      issue.title !== draft.title) ||
      (draft.body !== draft.baseBody &&
        issue.body !== draft.baseBody &&
        issue.body !== draft.body))
  );
}

type Notice = { kind: "success" | "error"; text: string };
const issueKey = (issue: IssueRef) =>
  ["issue", issue.repo, issue.number] as const;
const commentsKey = (issue: IssueRef) =>
  ["github", "comments", issue.repo, issue.number] as const;
const commentPostsKey = (issue: IssueRef) =>
  ["github", "comment-posts", issue.repo, issue.number] as const;
const firstCommentPage = (issue: IssueDetail): CommentPage => ({
  comments: issue.comments,
  hasMore: issue.commentsHasMore,
  nextPage: issue.commentsNextPage ?? (issue.commentsHasMore ? 2 : undefined),
});

export function mergeCommentPages(
  pages: CommentPage[],
  posted: Comment[],
): Comment[] {
  const comments = new Map<string, Comment>();
  for (const comment of [
    ...pages.flatMap((page) => page.comments),
    ...posted,
  ]) {
    const previous = comments.get(comment.id);
    if (
      !previous ||
      Date.parse(comment.updatedAt) >= Date.parse(previous.updatedAt)
    )
      comments.set(comment.id, comment);
  }
  return [...comments.values()];
}
const refKey = (issue: IssueRef) => `${issue.repo}#${issue.number}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const requestId = () => crypto.randomUUID();
const accountViews = [
  { value: "assigned", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
  { value: "mentioned", label: "Mentioned me" },
  { value: "all", label: "All account repositories" },
] as const;
const isInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="button"]',
    ),
  );

function StateIcon({ state }: { state: "open" | "closed" }) {
  return (
    <span
      className={`state-icon ${state}`}
      aria-label={state === "open" ? "Open" : "Closed"}
    >
      {state === "open" ? "◉" : "✓"}
    </span>
  );
}

function ShortDate({ date }: { date: string }) {
  return (
    <time dateTime={date} title={new Date(date).toLocaleString("en")}>
      {new Date(date).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      })}
    </time>
  );
}

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

export function App({ host }: { host: ArcoHost }) {
  const [launch, setLaunch] = useState(() =>
    host.launch ? host.launch() : personalLaunchContext,
  );
  useEffect(() => {
    const unsubscribe = host.subscribe((event) => {
      if (event === "launch") setLaunch(host.launch?.() ?? null);
    });
    setLaunch(host.launch ? host.launch() : personalLaunchContext);
    return unsubscribe;
  }, [host]);
  const [client] = useState(
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
      {launch ? (
        <Workspace host={host} launch={launch} />
      ) : (
        <WorkspaceSkeleton />
      )}
      <SelectionShare host={host} />
    </QueryClientProvider>
  );
}

function Workspace({
  host,
  launch,
}: {
  host: ArcoHost;
  launch: LaunchContext;
}) {
  const projectView = launch.view === "project";
  const [restoredShared] = useState(() => host.sharedIssue?.() ?? null);
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
  const { load: loadDraft, schedule: scheduleDraft } = persistence;
  const settings = useGitHubSettings(
    host,
    projectView ? { key: launch.projectKey } : undefined,
  );
  const [repoOverride, setRepoOverride] = useState<string | null>(
    restoreSharedView ? (restoredGithub?.repo ?? launch.repo) : launch.repo,
  );
  const [accountViewOverride, setAccountViewOverride] = useState<
    AccountIssuesInput["filter"] | null
  >(null);
  const [registeredRepos, setRegisteredRepos] = useState<string[]>([]);
  const previousSelection = useRef(new Map<string, number>());
  const [bulkIssues, setBulkIssues] = useState<BulkIssue[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [searchEntry, setSearchEntry] = useState<string | null>(null);
  const [searchError, setSearchError] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const urlRequest = useRef(0);
  useEffect(
    () => () => {
      urlRequest.current += 1;
    },
    [],
  );
  const [localFilters, setLocalFilters] = useState<Settings["githubFilters"]>(
    {},
  );
  const filtersRef = useRef<Settings["githubFilters"]>({});
  const [sourceOverride, setSourceOverride] = useState<
    "github" | "linear" | null
  >(
    (restoreSharedView ? restoredShared?.source : null) ??
      (projectView ? "github" : null),
  );
  const [selected, setSelected] = useState<IssueRef | null>(restoredSelection);
  const [showDetail, setShowDetail] = useState(false);
  const [shared, setShared] = useState<IssueRef | null>(restoredGithub);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef<Record<string, Draft>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [createDrafts, setCreateDrafts] = useState<
    Record<string, TemplateDraft>
  >({});
  const createDraftsRef = useRef<Record<string, TemplateDraft>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mode, setMode] = useState(host.mode());
  const [hostBusy, setHostBusy] = useState(false);
  const hostLock = useRef(false);
  const mutationLock = useRef(false);
  const pendingRequestIds = useRef(new Map<string, string>());
  const searchRef = useRef<HTMLInputElement>(null);
  const scopeSelectRef = useRef<SingleSelectHandle>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const restoredListScope = useRef<string | null>(null);
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
  const connectionIdentity = `${connection.data?.mode ?? "pending"}:${connection.data?.account ?? "disconnected"}`;
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
    ],
    queryFn: ({ pageParam }) =>
      host.call<RepositoryPage>("arco_repositories", { page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: connection.data?.connected === true,
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
  const { query, state, sort, order } = filter;
  const updateFilter = (patch: Partial<Settings["githubFilters"][string]>) => {
    const current = filtersRef.current[filterKey] ?? filter;
    const next = { ...current, ...patch };
    filtersRef.current = { ...filtersRef.current, [filterKey]: next };
    setLocalFilters(filtersRef.current);
    if (repo) settings.saveFilter(repo, next);
    else
      settings.saveAccountFilter({
        filter: accountView,
        state: next.state,
        sort: next.sort,
        order: next.order,
      });
  };
  const setQuery = (query: string) => updateFilter({ query });
  const setState = (state: "open" | "closed" | "all") =>
    updateFilter({ state });
  const setSort = (sort: "updated" | "created" | "comments") =>
    updateFilter({ sort });
  const setOrder = (order: "asc" | "desc") => updateFilter({ order });
  if (sourceOverride === null && settings.query.data)
    setSourceOverride(settings.query.data.settings.activeSource);
  const source =
    sourceOverride ?? settings.query.data?.settings.activeSource ?? "github";
  const setSource = (next: "github" | "linear") => {
    urlRequest.current += 1;
    setUrlBusy(false);
    setSourceOverride(next);
    if (!projectView) settings.setSource(next);
  };
  const createDraft = createDrafts[repo] ?? {
    title: "",
    body: "",
    labels: [],
    assignees: [],
    issueTypeName: "",
  };
  const repositories = [
    ...new Set(
      [
        repo,
        ...launch.candidates,
        connection.data?.defaultRepo,
        ...(settings.query.data?.settings.githubRepos ?? []),
        ...registeredRepos,
        ...(repositoryDiscovery.data?.pages.flatMap((page) =>
          page.repositories.map((repository) => repository.repo),
        ) ?? []),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const changeRepo = (
    nextRepo: string,
    nextAccountView?: AccountIssuesInput["filter"],
  ) => {
    if (mutationLock.current || bulkBusy) return;
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
  const listScope = `${connectionIdentity}|${repo || `@account:${accountView}`}|${query}|${state}|${sort}|${order}`;
  const issues = useInfiniteQuery({
    queryKey: [
      "issues",
      connection.data?.mode,
      connection.data?.account,
      connection.data?.connected,
      repo,
      accountView,
      query,
      state,
      sort,
      order,
    ],
    refetchInterval: 30_000,
    queryFn: ({ pageParam }) =>
      repo
        ? host.call<IssuePage>("arco_list_issues", {
            repo,
            query,
            state,
            sort,
            order,
            page: pageParam,
          })
        : host.call<AccountIssuePage>("arco_account_issues", {
            filter: accountView,
            state,
            sort,
            order,
            page: pageParam,
          }),
    enabled:
      source === "github" &&
      connection.data?.connected === true &&
      (!projectView || Boolean(repo)) &&
      !settings.query.isPending,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
  const rows = useMemo(
    () =>
      connection.data?.connected
        ? (issues.data?.pages.flatMap((page) => page.issues) ?? [])
        : [],
    [issues.data, connection.data?.connected],
  );
  if (!selected && rows[0]) {
    setSelected({ repo: rows[0].repo, number: rows[0].number });
  }
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
  const createDraftKey = useMemo<DraftKey | null>(
    () => (repo ? { source: "github", repo, issue: "new" } : null),
    [repo],
  );
  useEffect(() => {
    if (!activeDraftKey || activeDraftKey.source !== "github") return;
    const id = `${activeDraftKey.repo}#${activeDraftKey.issue}`;
    void loadDraft(activeDraftKey).then((saved) => {
      if (!saved || draftsRef.current[id]) return;
      draftsRef.current = { ...draftsRef.current, [id]: saved };
      setDrafts(draftsRef.current);
    });
  }, [activeDraftKey, loadDraft]);
  useEffect(() => {
    if (!createOpen || !createDraftKey || createDraftKey.source !== "github")
      return;
    const scope = createDraftKey.repo;
    void loadDraft(createDraftKey).then((saved) => {
      if (!saved || createDraftsRef.current[scope]) return;
      createDraftsRef.current = {
        ...createDraftsRef.current,
        [scope]: {
          title: saved.title,
          body: saved.body,
          labels: saved.githubLabels ?? [],
          assignees: saved.githubAssignees ?? [],
          issueTypeName: saved.githubIssueTypeName ?? "",
        },
      };
      setCreateDrafts(createDraftsRef.current);
    });
  }, [createOpen, createDraftKey, loadDraft]);
  const setCreateDraft = (
    value: TemplateDraft | ((previous: TemplateDraft) => TemplateDraft),
  ) => {
    const previous = createDraftsRef.current[repo] ?? {
      title: "",
      body: "",
      labels: [],
      assignees: [],
      issueTypeName: "",
    };
    const next = typeof value === "function" ? value(previous) : value;
    createDraftsRef.current = { ...createDraftsRef.current, [repo]: next };
    setCreateDrafts(createDraftsRef.current);
    if (createDraftKey)
      scheduleDraft(createDraftKey, {
        title: next.title,
        body: next.body,
        comment: "",
        githubLabels: next.labels,
        githubAssignees: next.assignees,
        githubIssueTypeName: next.issueTypeName || undefined,
      });
  };

  const detail = useQuery({
    queryKey: activeRef ? issueKey(activeRef) : ["issue", "none"],
    refetchInterval: 30_000,
    queryFn: ({ signal }) =>
      host.call<IssueDetail>(
        "arco_get_issue",
        {
          repo: activeRef!.repo,
          number: activeRef!.number,
        },
        { signal, priority: "background" },
      ),
    enabled: source === "github" && Boolean(activeRef),
  });
  const sharedDetail = useQuery({
    queryKey: shared ? issueKey(shared) : ["issue", "shared-none"],
    refetchInterval: 30_000,
    queryFn: ({ signal }) =>
      host.call<IssueDetail>(
        "arco_get_issue",
        {
          repo: shared!.repo,
          number: shared!.number,
        },
        { signal, priority: "background" },
      ),
    enabled: source === "github" && Boolean(shared),
  });
  const metadataRepo = activeRef?.repo ?? repo;
  const metadata = useQuery({
    queryKey: ["metadata", metadataRepo],
    queryFn: () =>
      host.call<RepoMetadata>("arco_repo_metadata", { repo: metadataRepo }),
    enabled:
      source === "github" &&
      Boolean(metadataRepo) &&
      connection.data?.connected === true,
  });
  const mutation = useMutation({
    mutationFn: ({
      name,
      args,
    }: {
      name: string;
      args: Record<string, unknown>;
    }) => host.call<IssueDetail>(name, args),
    onSuccess: async (result) => {
      if (result.postedComment)
        queryClient.setQueryData<Comment[]>(
          commentPostsKey(result),
          (previous = []) =>
            mergeCommentPages([], [...previous, result.postedComment!]),
        );
      queryClient.setQueryData(issueKey(result), result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["issues"] }),
        queryClient.invalidateQueries({ queryKey: issueKey(result) }),
        queryClient.invalidateQueries({ queryKey: commentsKey(result) }),
      ]);
    },
  });

  useEffect(
    () =>
      host.subscribe((event) => {
        if (event === "context") {
          const issue = host.sharedIssue?.();
          setShared(
            issue?.source === "github"
              ? { repo: issue.repo, number: issue.number }
              : null,
          );
          return;
        }
        setMode(host.mode());
        if (event === "data" && source === "github")
          void queryClient.invalidateQueries(
            {
              predicate: (entry) =>
                ["issue", "issues", "metadata", "github"].includes(
                  String(entry.queryKey[0]),
                ),
            },
            { cancelRefetch: false },
          );
      }),
    [host, queryClient, source],
  );
  useLayoutEffect(() => {
    const element = listRef.current;
    if (!element || !issues.isSuccess) {
      restoredListScope.current = null;
      return;
    }
    const scope = `${mode}:${listScope}`;
    if (restoredListScope.current !== scope) {
      element.scrollTop = scrollPositions.current.get(listScope) ?? 0;
      restoredListScope.current = scope;
    }
  }, [listScope, mode, issues.isSuccess]);
  const rememberListScroll = () => {
    if (listRef.current && restoredListScope.current === `${mode}:${listScope}`)
      scrollPositions.current.set(listScope, listRef.current.scrollTop);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (source !== "github") return;
      if (
        event.defaultPrevented ||
        isInput(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setShowDetail(false);
      }
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const index = rows.findIndex(
          (row) => activeRef && refKey(row) === refKey(activeRef),
        );
        const next =
          rows[
            Math.min(
              rows.length - 1,
              Math.max(0, index + (event.key === "j" ? 1 : -1)),
            )
          ];
        if (next) {
          setSelected({ repo: next.repo, number: next.number });
          setShowDetail(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, activeRef, source]);

  const save = async (
    name: string,
    args: Record<string, unknown>,
    after?: (result: IssueDetail) => void,
  ) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setNotice(null);
    const operationKey = JSON.stringify([name, args]);
    const operationId =
      pendingRequestIds.current.get(operationKey) ?? requestId();
    pendingRequestIds.current.set(operationKey, operationId);
    try {
      const result = await mutation.mutateAsync({
        name,
        args: { ...args, requestId: operationId },
      });
      pendingRequestIds.current.delete(operationKey);
      after?.(result);
      setNotice({
        kind: "success",
        text:
          connection.data?.mode === "fixture"
            ? "Local fixture updated."
            : "Saved to GitHub and refreshed.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: errorText(error) });
      await queryClient.invalidateQueries({ queryKey: ["issue"] });
      await queryClient.invalidateQueries({ queryKey: ["issues"] });
    } finally {
      mutationLock.current = false;
    }
  };
  const hostAction = async (action: () => Promise<void>, success: string) => {
    if (hostLock.current) return;
    hostLock.current = true;
    setHostBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: success });
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
      setMode(host.mode());
    }, "Display mode changed.");
  const updateDraft = (issue: IssueDetail, patch: Partial<Draft>) => {
    const current = resolveDraft(issue, draftsRef.current[refKey(issue)]);
    const startsContentEdit =
      ("title" in patch || "body" in patch) && !current.baseUpdatedAt;
    const next = {
      ...current,
      ...(startsContentEdit
        ? {
            baseUpdatedAt: issue.updatedAt,
            baseTitle: issue.title,
            baseBody: issue.body,
          }
        : {}),
      ...patch,
    };
    draftsRef.current = { ...draftsRef.current, [refKey(issue)]: next };
    setDrafts(draftsRef.current);
    scheduleDraft(
      { source: "github", repo: issue.repo, issue: String(issue.number) },
      next,
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
      if (mutationLock.current || bulkBusy)
        throw new Error(
          "Wait for the current change before opening another issue.",
        );
      const issue = await host.call<IssueDetail>("arco_get_issue", target);
      if (request !== urlRequest.current) return;
      if (
        issue.repo.toLowerCase() !== target.repo.toLowerCase() ||
        issue.number !== target.number
      )
        throw new Error(
          "GitHub returned a different issue than the pasted URL.",
        );
      const resolved = { repo: issue.repo, number: issue.number };
      queryClient.setQueryData(issueKey(resolved), issue);
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
    if (mutation.isPending) return;
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
  const retainedIssue =
    sharedDetail.data ?? (!shared ? selectedDetail : undefined);
  const compactError = sharedDetail.isError
    ? errorText(sharedDetail.error)
    : detail.isError
      ? errorText(detail.error)
      : connection.isError
        ? errorText(connection.error)
        : settings.query.isError
          ? errorText(settings.query.error)
          : issues.isError
            ? errorText(issues.error)
            : null;
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
      if (retainedIssue.repo !== repo) changeRepo(retainedIssue.repo);
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
      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`notice ${notice.kind}`}
        >
          <span>{notice.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {detail.isError && selectedDetail && (
        <div className="notice error" role="alert">
          <span>
            <strong>Could not refresh this issue.</strong> Showing the last
            loaded version. {errorText(detail.error)}
          </span>
          <Button
            color="secondary"
            variant="outline"
            size="sm"
            disabled={detail.isFetching}
            onClick={() => void detail.refetch()}
          >
            Retry refresh
          </Button>
        </div>
      )}
      {selectedDetail && activeDraftKey && (
        <DraftStatus
          status={persistence.statuses[draftStorageId(activeDraftKey)]}
          onRetry={() =>
            persistence.retry(
              activeDraftKey,
              draftsRef.current[refKey(selectedDetail)] ??
                resolveDraft(selectedDetail),
            )
          }
          onResolve={(choice) => {
            void persistence
              .resolve(
                activeDraftKey,
                choice,
                draftsRef.current[refKey(selectedDetail)] ??
                  resolveDraft(selectedDetail),
              )
              .then((saved) => {
                if (saved === undefined) return;
                draftsRef.current = {
                  ...draftsRef.current,
                  [refKey(selectedDetail)]:
                    saved ?? resolveDraft(selectedDetail),
                };
                setDrafts(draftsRef.current);
              });
          }}
        />
      )}
    </>
  );

  if (settings.query.isPending) return <WorkspaceSkeleton mode={mode} />;

  if (source === "linear")
    return <LinearWorkspace host={host} onSourceChange={setSource} />;

  if (connection.isPending) return <WorkspaceSkeleton mode={mode} />;

  if (
    mode === "inline" &&
    !retainedIssue &&
    !compactError &&
    connection.data?.connected &&
    (initialIssuesLoading ||
      (detail.isPending && Boolean(activeRef)) ||
      (sharedDetail.isPending && Boolean(shared)))
  )
    return <InlineSkeleton />;

  if (mode === "inline")
    return (
      <main
        className="arco compact-mode inline-mode"
        data-arco-issue={
          retainedIssue ? selectionIssueData(retainedIssue) : undefined
        }
      >
        <div className="compact-top">
          <strong className="wordmark">Arco</strong>
          <span className="muted">{shared ? "Shared issue" : "Browsing"}</span>
          <button
            className="icon-button"
            aria-label="Expand"
            onClick={openRetainedDetails}
          >
            ↗
          </button>
        </div>
        {retainedIssue ? (
          <>
            <div className="issue-kicker">
              <StateIcon state={retainedIssue.state} />
              <span>
                {retainedIssue.repo} #{retainedIssue.number}
              </span>
            </div>
            <h1>{retainedIssue.title}</h1>
            <p className="compact-summary">
              {retainedIssue.body.slice(0, 220)}
              {retainedIssue.body.length > 220 ? "…" : ""}
            </p>
            <div className="compact-bottom">
              <span className="muted">
                Updated <ShortDate date={retainedIssue.updatedAt} />
              </span>
              <Button
                color="secondary"
                variant="outline"
                size="sm"
                onClick={openRetainedDetails}
              >
                Open details
              </Button>
            </div>
          </>
        ) : compactError ? (
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
              {`${repo || accountViewLabel} · ${state === "all" ? "All states" : state === "closed" ? "Closed" : "Open"}${repo && query ? ` · ${query}` : ""}`}
            </p>
            {issues.hasNextPage ? (
              <Button
                color="secondary"
                variant="outline"
                size="sm"
                loading={issues.isFetchingNextPage}
                disabled={issues.isFetchingNextPage}
                onClick={() => void issues.fetchNextPage()}
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
    <main
      className={`arco workspace ${showDetail ? "show-detail" : ""}`}
      data-viewer={projectView ? "project" : "personal"}
    >
      <aside className="issue-sidebar" aria-label="Issues">
        <div className="sidebar-heading">
          <div className="sidebar-identity">
            <strong className="wordmark">Arco</strong>
            <SingleSelect
              className="source-select"
              label="Issue source"
              value="github"
              options={[
                { value: "github", label: "GitHub" },
                { value: "linear", label: "Linear" },
              ]}
              onChange={(value) => {
                if (value === "linear") setSource("linear");
              }}
            />
          </div>
          <button
            className="icon-button"
            aria-label="Create issue"
            title={
              repo ? "Create issue" : "Choose a repository to create an issue"
            }
            onClick={() => {
              if (repo) setCreateOpen(true);
              else scopeSelectRef.current?.open();
            }}
            disabled={!connection.data?.connected}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        <div className="scope-picker">
          <h2 className="viewer-title">
            {projectView
              ? "Project issues"
              : repo
                ? "Repository issues"
                : "My issues"}
          </h2>
          <SingleSelect
            ref={scopeSelectRef}
            id="github-scope"
            className="scope-select"
            label="GitHub scope"
            value={repo || (projectView ? "" : `account:${accountView}`)}
            disabled={mutation.isPending || bulkBusy}
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
                      label: "Account views",
                      options: accountViews.map((view) => ({
                        value: `account:${view.value}`,
                        label: view.label,
                      })),
                    },
                  ]
                : [
                    {
                      label: "Project",
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
                          const info = repositoryDiscovery.data?.pages
                            .flatMap((page) => page.repositories)
                            .find((repository) => repository.repo === value);
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
          <p className="viewer-description">
            {projectView
              ? launch.projectName
                ? `Repository for ${launch.projectName}`
                : "Repository for this chat"
              : repo
                ? "Issues in this repository"
                : "Your issues across repositories"}
          </p>
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
                  disabled={mutation.isPending}
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
              onClick={() =>
                repo
                  ? settings.register(repo, registeredRepos)
                  : settings.setAccountScope()
              }
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
              value={searchEntry ?? (repo ? query : "")}
              disabled={!connection.data?.connected}
              aria-describedby={searchError ? "github-search-error" : undefined}
              onChange={(event) => {
                urlRequest.current += 1;
                setUrlBusy(false);
                setSearchError("");
                rememberListScroll();
                const value = event.target.value;
                if (isIssueUrlInput(value) || !repo) setSearchEntry(value);
                else {
                  setSearchEntry(null);
                  setQuery(value);
                }
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
                  aria-pressed={state === value}
                  onClick={() => {
                    rememberListScroll();
                    setState(value);
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
                value={sort}
                onChange={(value) => {
                  rememberListScroll();
                  setSort(value as "updated" | "created" | "comments");
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
                value={order}
                onChange={(value) => {
                  rememberListScroll();
                  setOrder(value === "asc" ? "asc" : "desc");
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
                value={/(?:^|\s)project:([^\s]+)/.exec(query)?.[1] ?? ""}
                onChange={(value) => {
                  rememberListScroll();
                  const rest = query
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
            {issues.isFetching && !issues.isPending
              ? "Refreshing…"
              : repo
                ? `${state === "all" ? "All" : state === "closed" ? "Closed" : "Open"} issues`
                : projectView
                  ? "Repository not selected"
                  : accountViewLabel}
          </span>
          <span>
            {rows.length} {rows.length === 1 ? "issue" : "issues"}
            {issues.hasNextPage ? "+" : ""}
          </span>
        </div>
        <div
          className={`issue-list${issues.isFetching && !issues.isPending ? " refreshing" : ""}`}
          ref={listRef}
          onScroll={rememberListScroll}
          aria-busy={issues.isFetching}
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
          {issues.isError && (
            <div className="list-message inline-error" role="alert">
              {errorText(issues.error)}
              <button
                className="text-button"
                onClick={() => void issues.refetch()}
              >
                Retry
              </button>
            </div>
          )}
          {rows.map((issue) => (
            <div className="selectable-row" key={refKey(issue)}>
              <input
                type="checkbox"
                aria-label={`Select ${issue.repo} #${issue.number} for bulk actions`}
                checked={bulkIssues.some(
                  (value) => refKey(value) === refKey(issue),
                )}
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
            <button
              className="load-more"
              disabled={issues.isFetchingNextPage}
              onClick={() => void issues.fetchNextPage()}
            >
              {issues.isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
        {bulkIssues.length > 0 && (
          <BulkActions
            host={host}
            issues={bulkIssues}
            onClear={() => setBulkIssues([])}
            onBusy={setBulkBusy}
          />
        )}
        <div className="sidebar-footer sidebar-account">
          <div className="connection-line">
            <span
              className={`connection-dot ${connection.data?.connected ? "connected" : ""}`}
            />
            {connection.data?.mode === "fixture"
              ? "Local fixture"
              : connection.data?.account || "Disconnected"}
            {connection.data?.mode === "fixture" && (
              <span className="muted">· Local verification</span>
            )}
          </div>
        </div>
      </aside>
      <section
        className={`detail-pane${detail.isFetching && !detail.isPending ? " refreshing" : ""}`}
        aria-label="Issue details"
        aria-busy={detail.isFetching || detailLoading}
        data-arco-issue={
          selectedDetail ? selectionIssueData(selectedDetail) : undefined
        }
      >
        {!selectedDetail && (
          <header className="detail-toolbar">
            <span className="toolbar-tab">Issue</span>
          </header>
        )}
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
          <div className="empty-state">
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
          </div>
        )}
        {selectedDetail && (
          <IssueContent
            key={refKey(selectedDetail)}
            issue={selectedDetail}
            feedback={detailFeedback}
            onBack={() => setShowDetail(false)}
            onFullscreen={() => void switchMode("fullscreen")}
            draft={resolveDraft(selectedDetail, drafts[refKey(selectedDetail)])}
            onDraft={(patch) => updateDraft(selectedDetail, patch)}
            metadata={metadata.data}
            metadataError={metadata.error}
            busy={mutation.isPending}
            save={save}
            host={host}
            hostBusy={hostBusy}
            hostAction={hostAction}
            shared={shared}
          />
        )}
      </section>
      <AnimatedDialogBackdrop
        open={createOpen}
        onClick={(event) => {
          if (event.target === event.currentTarget) setCreateOpen(false);
        }}
      >
        <section
          className="create-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-title"
          onKeyDown={(event) => {
            if (
              event.defaultPrevented ||
              (event.target instanceof Element &&
                event.target.closest('[role="dialog"]') !== event.currentTarget)
            )
              return;
            if (event.key === "Escape") {
              event.stopPropagation();
              setCreateOpen(false);
            }
            if (event.key === "Tab") {
              const elements = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), [role="button"][tabindex="0"]:not([aria-disabled="true"])',
                ),
              ];
              const first = elements[0];
              const last = elements[elements.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div className="dialog-heading">
            <h2 id="create-title">Create issue</h2>
            <button
              className="icon-button"
              aria-label="Close create issue"
              onClick={() => setCreateOpen(false)}
            >
              ×
            </button>
          </div>
          <p className="muted">
            Create in: {repo}{" "}
            {connection.data?.mode === "fixture" && "· Local fixture"}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(
                "arco_create_issue",
                {
                  repo,
                  title: createDraft.title,
                  body: createDraft.body,
                  labels: createDraft.labels,
                  assignees: createDraft.assignees,
                  ...(createDraft.issueTypeName
                    ? { issueTypeName: createDraft.issueTypeName }
                    : {}),
                },
                (result) => {
                  setRepoOverride(result.repo);
                  setSelected({ repo: result.repo, number: result.number });
                  setShowDetail(true);
                  setCreateDraft({
                    title: "",
                    body: "",
                    labels: [],
                    assignees: [],
                    issueTypeName: "",
                  });
                  setCreateOpen(false);
                },
              );
            }}
          >
            {createDraftKey && (
              <DraftStatus
                status={persistence.statuses[draftStorageId(createDraftKey)]}
                onRetry={() =>
                  persistence.retry(createDraftKey, {
                    title: createDraft.title,
                    body: createDraft.body,
                    comment: "",
                    githubLabels: createDraft.labels,
                    githubAssignees: createDraft.assignees,
                    githubIssueTypeName: createDraft.issueTypeName || undefined,
                  })
                }
                onResolve={(choice) => {
                  const local: SavedDraft = {
                    title: createDraft.title,
                    body: createDraft.body,
                    comment: "",
                    githubLabels: createDraft.labels,
                    githubAssignees: createDraft.assignees,
                    githubIssueTypeName: createDraft.issueTypeName || undefined,
                  };
                  void persistence
                    .resolve(createDraftKey, choice, local)
                    .then((saved) => {
                      if (saved === undefined) return;
                      createDraftsRef.current = {
                        ...createDraftsRef.current,
                        [repo]: saved
                          ? {
                              title: saved.title,
                              body: saved.body,
                              labels: saved.githubLabels ?? [],
                              assignees: saved.githubAssignees ?? [],
                              issueTypeName: saved.githubIssueTypeName ?? "",
                            }
                          : {
                              title: "",
                              body: "",
                              labels: [],
                              assignees: [],
                              issueTypeName: "",
                            },
                      };
                      setCreateDrafts(createDraftsRef.current);
                    });
                }}
              />
            )}
            <TemplatePicker
              host={host}
              repo={repo}
              disabled={mutation.isPending}
              onApply={setCreateDraft}
            />
            {(createDraft.labels.length > 0 ||
              createDraft.assignees.length > 0 ||
              Boolean(createDraft.issueTypeName)) && (
              <div className="template-defaults">
                <strong>Initial attributes</strong>
                {createDraft.issueTypeName && (
                  <button
                    type="button"
                    className="label"
                    disabled={mutation.isPending}
                    title="Remove initial issue type"
                    onClick={() =>
                      setCreateDraft((previous) => ({
                        ...previous,
                        issueTypeName: "",
                      }))
                    }
                  >
                    Issue type: {createDraft.issueTypeName} ×
                  </button>
                )}
                <div>
                  {createDraft.labels.map((name) => (
                    <button
                      type="button"
                      className="label"
                      key={name}
                      disabled={mutation.isPending}
                      title="Remove initial label"
                      onClick={() =>
                        setCreateDraft((previous) => ({
                          ...previous,
                          labels: previous.labels.filter(
                            (value) => value !== name,
                          ),
                        }))
                      }
                    >
                      {name} ×
                    </button>
                  ))}
                </div>
                <div>
                  {createDraft.assignees.map((name) => (
                    <button
                      type="button"
                      className="label"
                      key={name}
                      disabled={mutation.isPending}
                      title="Remove initial assignee"
                      onClick={() =>
                        setCreateDraft((previous) => ({
                          ...previous,
                          assignees: previous.assignees.filter(
                            (value) => value !== name,
                          ),
                        }))
                      }
                    >
                      Assignee: {name} ×
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label>
              Title
              <input
                autoFocus
                required
                maxLength={256}
                disabled={mutation.isPending}
                value={createDraft.title}
                onChange={(event) =>
                  setCreateDraft((previous) => ({
                    ...previous,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Body
              <textarea
                rows={9}
                disabled={mutation.isPending}
                value={createDraft.body}
                onChange={(event) =>
                  setCreateDraft((previous) => ({
                    ...previous,
                    body: event.target.value,
                  }))
                }
              />
            </label>
            <p className="muted">
              Markdown is supported. Use GitHub for complex issue forms.
            </p>
            {notice?.kind === "error" && (
              <p className="inline-error" role="alert">
                {notice.text}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                color="secondary"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Close
              </Button>
              <Button
                type="submit"
                color="primary"
                disabled={!createDraft.title.trim() || mutation.isPending}
                loading={mutation.isPending}
              >
                {connection.data?.mode === "fixture"
                  ? "Create fixture issue"
                  : "Create on GitHub"}
              </Button>
            </div>
          </form>
        </section>
      </AnimatedDialogBackdrop>
    </main>
  );
}

type ContentProps = {
  feedback: ReactNode;
  onBack: () => void;
  onFullscreen: () => void;
  issue: IssueDetail;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  metadata?: RepoMetadata;
  metadataError: Error | null;
  busy: boolean;
  save: (
    name: string,
    args: Record<string, unknown>,
    after?: (result: IssueDetail) => void,
  ) => Promise<void>;
  host: ArcoHost;
  hostBusy: boolean;
  hostAction: (action: () => Promise<void>, success: string) => Promise<void>;
  shared: IssueRef | null;
};

function IssueContent({
  feedback,
  onBack,
  onFullscreen,
  issue,
  draft,
  onDraft,
  metadata,
  metadataError,
  busy,
  save,
  host,
  hostBusy,
  hostAction,
  shared,
}: ContentProps) {
  const client = useQueryClient();
  const comments = useInfiniteQuery({
    queryKey: commentsKey(issue),
    initialPageParam: 1,
    initialData: { pages: [firstCommentPage(issue)], pageParams: [1] },
    structuralSharing: (previous, incoming) => {
      const pages = incoming as InfiniteData<CommentPage, number>;
      const current = client.getQueryData<IssueDetail>(issueKey(issue));
      if (!current) return replaceEqualDeep(previous, pages);
      // A continuation can finish after a newer detail refresh. Its captured
      // first page must never replace the current issue's first page.
      return replaceEqualDeep(previous, {
        pages: [
          firstCommentPage(current),
          ...(current.commentsHasMore ? pages.pages.slice(1) : []),
        ],
        pageParams: current.commentsHasMore ? pages.pageParams : [1],
      });
    },
    staleTime: Infinity,
    refetchInterval: 30_000,
    queryFn: ({ pageParam, signal }) => {
      // The detail query refreshes the first page. Only explicitly loaded
      // continuation pages need additional provider reads during refresh.
      if (pageParam === 1)
        return firstCommentPage(
          client.getQueryData<IssueDetail>(issueKey(issue)) ?? issue,
        );
      return host.call<CommentPage>(
        "arco_comments",
        {
          repo: issue.repo,
          number: issue.number,
          page: pageParam,
        },
        { signal, priority: "background" },
      );
    },
    getNextPageParam: (page) => (page.hasMore ? page.nextPage : undefined),
  });
  const posted = useQuery<Comment[]>({
    queryKey: commentPostsKey(issue),
    queryFn: () => [],
    initialData: [],
    enabled: false,
  });
  useEffect(() => {
    client.setQueryData<InfiniteData<CommentPage, number>>(
      commentsKey(issue),
      (previous) => ({
        pages: [
          firstCommentPage(issue),
          ...(issue.commentsHasMore ? (previous?.pages.slice(1) ?? []) : []),
        ],
        pageParams: issue.commentsHasMore ? (previous?.pageParams ?? [1]) : [1],
      }),
    );
  }, [client, issue]);
  useEffect(() => {
    const loaded = new Map(
      comments.data.pages.flatMap((page) =>
        page.comments.map((comment) => [comment.id, comment] as const),
      ),
    );
    const confirmed = (comment: Comment) => {
      const native = loaded.get(comment.id);
      return (
        native !== undefined &&
        (Date.parse(native.updatedAt) > Date.parse(comment.updatedAt) ||
          (native.updatedAt === comment.updatedAt &&
            native.body === comment.body))
      );
    };
    client.setQueryData<Comment[]>(commentPostsKey(issue), (previous) =>
      previous?.some(confirmed)
        ? previous.filter((comment) => !confirmed(comment))
        : previous,
    );
  }, [client, comments.data, issue]);
  const visibleComments = mergeCommentPages(comments.data.pages, posted.data);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [compareLatest, setCompareLatest] = useState(false);
  const assigneeOptions = [
    ...new Set([...issue.assignees, ...(metadata?.assignees ?? [])]),
  ].map((name) => ({ value: name, label: name }));
  const labelOptions = [
    ...new Map(
      [...issue.labels, ...(metadata?.labels ?? [])].map((label) => [
        label.id,
        label,
      ]),
    ).values(),
  ];
  const openMarkdownLink = (url: string) =>
    void hostAction(() => host.openLink(url), "Opened the source link.");
  const ref = { repo: issue.repo, number: issue.number };
  const dirty = draft.title !== issue.title || draft.body !== issue.body;
  const contentConflict = draftConflict(issue, draft);
  const share = () =>
    hostAction(
      () => host.share(issue),
      "Shared the issue with the chat context.",
    );

  return (
    <>
      <DetailToolbar
        tab="Issue"
        backLabel="Back to list"
        onBack={onBack}
        shared={
          shared ? (
            <span
              className="shared-chip"
              title={`${shared.repo} #${shared.number}`}
            >
              Chat #{shared.number}
            </span>
          ) : undefined
        }
        primary={
          <Button
            color="primary"
            size="sm"
            disabled={hostBusy}
            onClick={() => void share()}
          >
            Add to chat
          </Button>
        }
        utilities={
          <>
            <button
              className="utility-item"
              aria-label="Edit issue"
              onClick={() => setEditing((value) => !value)}
            >
              <Edit aria-hidden="true" /> Edit issue
            </button>
            <div className="utility-item">
              <CopyValue value={issue.url} onCopied={closeDetailUtility} />
            </div>
            <div className="utility-item">
              <CopyValue
                value={`${issue.repo}#${issue.number}`}
                label="Copy ID"
                onCopied={closeDetailUtility}
              />
            </div>
            <button
              className="utility-item"
              aria-label="Open on GitHub"
              onClick={() =>
                void hostAction(
                  () => host.openLink(issue.url),
                  "Opened GitHub.",
                )
              }
            >
              <ExternalLink aria-hidden="true" /> Open on GitHub
            </button>
            <button
              className="utility-item"
              aria-label="Open fullscreen"
              onClick={onFullscreen}
            >
              <Expand aria-hidden="true" /> Open fullscreen
            </button>
          </>
        }
      />
      {feedback}
      <div className="detail-scroll motion-content">
        <div className="issue-heading">
          <div className="issue-kicker">
            <span className={`state-pill ${issue.state}`}>
              <StateIcon state={issue.state} />
              {issue.state === "open" ? "Open" : "Closed"}
            </span>
            <span>
              {issue.repo} <strong>#{issue.number}</strong>
            </span>
            {issue.stateReason && issue.state === "closed" && (
              <span className="muted">
                {issue.stateReason === "not_planned"
                  ? "Not planned"
                  : "Completed"}
              </span>
            )}
          </div>
          <div className="title-line">
            <h1>{issue.title}</h1>
          </div>
          <div className="author-line">
            <span className="avatar">
              {issue.author.slice(0, 1).toUpperCase()}
            </span>
            <strong>{issue.author}</strong>
            <span>
              Updated <ShortDate date={issue.updatedAt} />
            </span>
            {dirty && <span className="draft-mark">Unsaved draft</span>}
          </div>
          {shared && (
            <div className="shared-target">
              Shared issue:{" "}
              <strong>
                {shared.repo} #{shared.number}
              </strong>
              {refKey(shared) !== refKey(issue) && (
                <span> · Different from the issue you are browsing</span>
              )}
            </div>
          )}
        </div>
        <div className="issue-columns">
          <article className="issue-main">
            {editing ? (
              <section className="editor" aria-label="Edit issue body">
                <label>
                  Title
                  <input
                    aria-label="Issue title"
                    disabled={busy}
                    value={draft.title}
                    maxLength={256}
                    onChange={(event) => onDraft({ title: event.target.value })}
                  />
                </label>
                <div className="editor-tabs">
                  <button
                    aria-pressed={!preview}
                    onClick={() => setPreview(false)}
                  >
                    Edit
                  </button>
                  <button
                    aria-pressed={preview}
                    onClick={() => setPreview(true)}
                  >
                    Preview
                  </button>
                </div>
                {preview ? (
                  <IssueMarkdown
                    body={draft.body}
                    onOpen={openMarkdownLink}
                    image={{ host, issue }}
                  />
                ) : (
                  <textarea
                    aria-label="Issue body"
                    rows={14}
                    disabled={busy}
                    value={draft.body}
                    onChange={(event) => onDraft({ body: event.target.value })}
                  />
                )}
                {contentConflict && (
                  <section
                    className="draft-conflict"
                    aria-label="Content conflict"
                    role="alert"
                  >
                    <strong>
                      The title or body changed on GitHub while you were
                      editing.
                    </strong>
                    <p>
                      Your draft is preserved. Compare the latest content before
                      saving.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setCompareLatest((value) => !value)}
                    >
                      {compareLatest
                        ? "Close comparison"
                        : "Compare latest content"}
                    </button>
                    {compareLatest && (
                      <div className="latest-content">
                        <h3>Latest content on GitHub</h3>
                        <strong>{issue.title}</strong>
                        <IssueMarkdown
                          body={issue.body}
                          image={{ host, issue }}
                          onOpen={openMarkdownLink}
                        />
                        <div className="editor-actions">
                          <Button
                            color="secondary"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              onDraft({
                                baseUpdatedAt: issue.updatedAt,
                                baseTitle: issue.title,
                                baseBody: issue.body,
                              });
                              setCompareLatest(false);
                            }}
                          >
                            Keep draft and use latest revision
                          </Button>
                          <Button
                            color="secondary"
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              onDraft({
                                title: issue.title,
                                body: issue.body,
                                baseUpdatedAt: issue.updatedAt,
                                baseTitle: issue.title,
                                baseBody: issue.body,
                              });
                              setCompareLatest(false);
                            }}
                          >
                            Discard draft and use latest content
                          </Button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
                <div className="editor-actions">
                  <span className="muted">
                    Drafts stay available when you switch issues.
                  </span>
                  <Button
                    color="secondary"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                  >
                    Close
                  </Button>
                  <Button
                    color="primary"
                    size="sm"
                    disabled={
                      busy || !draft.title.trim() || !dirty || contentConflict
                    }
                    loading={busy}
                    onClick={() =>
                      void save(
                        "arco_update_issue",
                        {
                          ...ref,
                          expectedUpdatedAt: issue.updatedAt,
                          patch: {
                            ...(draft.title !== issue.title
                              ? { title: draft.title }
                              : {}),
                            ...(draft.body !== issue.body
                              ? { body: draft.body }
                              : {}),
                          },
                        },
                        (result) => {
                          onDraft({
                            title: result.title,
                            body: result.body,
                            baseUpdatedAt: result.updatedAt,
                            baseTitle: result.title,
                            baseBody: result.body,
                          });
                          setEditing(false);
                        },
                      )
                    }
                  >
                    Save changes
                  </Button>
                </div>
              </section>
            ) : (
              <section className="issue-body" data-context-origin="body">
                <IssueMarkdown
                  body={issue.body}
                  image={{ host, issue }}
                  onOpen={openMarkdownLink}
                  busy={busy || dirty}
                  onToggleTask={(line, checked) => {
                    const body = toggleMarkdownTask(issue.body, line, checked);
                    if (body !== issue.body)
                      void save("arco_update_issue", {
                        ...ref,
                        expectedUpdatedAt: issue.updatedAt,
                        patch: { body },
                      });
                  }}
                />
              </section>
            )}
            <ReactionBar host={host} issue={issue} />
            <section
              className="comments-section"
              aria-labelledby={`comments-${issue.number}`}
            >
              <h2 id={`comments-${issue.number}`}>
                Comments{" "}
                <span>
                  {visibleComments.length}
                  {comments.hasNextPage ? "+" : ""}
                </span>
              </h2>
              {visibleComments.map((comment) => (
                <article className="comment" key={comment.id}>
                  <div className="comment-heading">
                    <span className="avatar">
                      {comment.author.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{comment.author}</strong>
                    <ShortDate date={comment.updatedAt} />
                    <button
                      className="icon-button"
                      aria-label={`Open ${comment.author}’s comment on GitHub`}
                      onClick={() =>
                        void hostAction(
                          () => host.openLink(comment.url),
                          "Opened the comment on GitHub.",
                        )
                      }
                    >
                      ↗
                    </button>
                  </div>
                  <div
                    data-context-origin="comment"
                    data-comment-id={comment.id}
                  >
                    <IssueMarkdown
                      body={comment.body}
                      image={{ host, issue, commentId: comment.databaseId }}
                      onOpen={openMarkdownLink}
                    />
                  </div>
                  <CommentActions host={host} issue={issue} comment={comment} />
                </article>
              ))}
              {!visibleComments.length && (
                <p className="muted no-comments">No comments yet.</p>
              )}
              {comments.hasNextPage && (
                <button
                  className="text-button"
                  disabled={comments.isFetching}
                  onClick={() => void comments.fetchNextPage()}
                >
                  {comments.isFetchingNextPage
                    ? "Loading comments…"
                    : "Load more comments"}
                </button>
              )}
              {comments.isError && (
                <p className="inline-error" role="alert">
                  Could not load comments. {errorText(comments.error)}
                </p>
              )}
              <form
                className="comment-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    "arco_comment",
                    { ...ref, body: draft.comment },
                    () => onDraft({ comment: "" }),
                  );
                }}
              >
                <label htmlFor={`comment-${issue.number}`}>
                  Comment on GitHub
                </label>
                <textarea
                  id={`comment-${issue.number}`}
                  disabled={busy}
                  value={draft.comment}
                  rows={3}
                  placeholder="Write a comment in Markdown…"
                  onChange={(event) => onDraft({ comment: event.target.value })}
                />
                <div className="comment-form-footer">
                  <span className="muted">
                    Posting to issue #{issue.number}
                  </span>
                  <Button
                    type="submit"
                    color="secondary"
                    variant="outline"
                    size="sm"
                    disabled={busy || !draft.comment.trim()}
                    loading={busy}
                  >
                    Post comment
                  </Button>
                </div>
              </form>
            </section>
          </article>
          <aside className="issue-properties" aria-label="Issue attributes">
            <section className="state-property">
              <h2>Issue state</h2>
              <SingleSelect
                label="Change issue state"
                value={
                  issue.state === "open"
                    ? "open"
                    : issue.stateReason === "not_planned"
                      ? "not_planned"
                      : "completed"
                }
                disabled={busy}
                onChange={(value) => {
                  void save("arco_update_issue", {
                    ...ref,
                    expectedUpdatedAt: issue.updatedAt,
                    patch:
                      value === "open"
                        ? { state: "open", stateReason: "reopened" }
                        : { state: "closed", stateReason: value },
                  });
                }}
                options={[
                  { value: "open", label: "Open" },
                  { value: "completed", label: "Closed · Completed" },
                  { value: "not_planned", label: "Closed · Not planned" },
                ]}
              />
            </section>
            <section>
              <h2>
                Projects <span className="muted">Status</span>
              </h2>
              {issue.projects.map((project) => (
                <label
                  className="project-property"
                  key={`${project.projectId}:${project.fieldId}`}
                >
                  <span>{project.projectTitle}</span>
                  <SingleSelect
                    label={`${project.projectTitle} status`}
                    value={project.optionId ?? ""}
                    disabled={busy}
                    onChange={(value) => {
                      if (value)
                        void save("arco_project_status", {
                          ...ref,
                          projectId: project.projectId,
                          itemId: project.itemId,
                          fieldId: project.fieldId,
                          optionId: value,
                        });
                    }}
                    options={[
                      { value: "", label: "No status", disabled: true },
                      ...project.options.map((option) => ({
                        value: option.id,
                        label: option.name,
                      })),
                    ]}
                  />
                </label>
              ))}
              {issue.projectsError && (
                <p className="inline-error" role="alert">
                  {issue.projectsError}
                </p>
              )}
              {!issue.projects.length && !issue.projectsError && (
                <p className="muted">No Project membership</p>
              )}
              <p className="property-note">
                Independent of the issue’s Open / Closed state.
              </p>
            </section>
            <section>
              <h2>Assignees</h2>
              <MultiSelect
                label="Assignees"
                value={issue.assignees}
                options={assigneeOptions}
                disabled={busy || !metadata}
                placeholder="Unassigned"
                onChange={(assignees) =>
                  void save("arco_update_issue", {
                    ...ref,
                    expectedUpdatedAt: issue.updatedAt,
                    patch: { assignees },
                  })
                }
              />
              {metadataError && (
                <p className="inline-error" role="alert">
                  {errorText(metadataError)}
                </p>
              )}
              {!metadata && !metadataError && (
                <p className="muted">Loading assignees…</p>
              )}
              {metadata && assigneeOptions.length === 0 && (
                <p className="muted">No assignable users.</p>
              )}
            </section>
            <section>
              <h2>Labels</h2>
              <MultiSelect
                label="Labels"
                value={issue.labels.map((label) => label.id)}
                options={labelOptions.map((label) => ({
                  value: label.id,
                  label: label.name,
                  color: label.color,
                }))}
                disabled={busy || !metadata}
                placeholder="None"
                onChange={(values) =>
                  void save("arco_change_labels", {
                    ...ref,
                    add: labelOptions
                      .filter(
                        (label) =>
                          values.includes(label.id) &&
                          !issue.labels.some(
                            (current) => current.id === label.id,
                          ),
                      )
                      .map((label) => label.name),
                    remove: issue.labels
                      .filter((label) => !values.includes(label.id))
                      .map((label) => label.name),
                  })
                }
              />
              {metadataError && (
                <p className="inline-error" role="alert">
                  {errorText(metadataError)}
                </p>
              )}
              {!metadata && !metadataError && (
                <p className="muted">Loading labels…</p>
              )}
              {metadata && labelOptions.length === 0 && (
                <p className="muted">No existing labels.</p>
              )}
            </section>
            <details className="property-advanced">
              <DisclosureSummary>More properties</DisclosureSummary>
              <GitHubProperties host={host} issue={issue} />
              <GitHubRelations host={host} issue={issue} />
              <LabelManager host={host} repo={issue.repo} />
            </details>
          </aside>
        </div>
      </div>
    </>
  );
}

export default App;
