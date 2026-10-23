import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCw,
  DotsHorizontalMoreMenu,
  Filter,
  MagnifyingGlassSearch,
  Plus,
} from "@openai/apps-sdk-ui/components/Icon";
import type { ArcoHost, DisplayMode } from "../shared/contracts";
import type {
  LinearConnection,
  LinearIssue,
  LinearMetadata,
  LinearPage,
  LinearRef,
  LinearSavedReceipt,
  LinearScope,
  LinearScopes,
  LinearTemplate,
} from "../shared/linear";
import {
  DraftStatus,
  draftStorageId,
  useDraftPersistence,
} from "./useDraftPersistence";
import {
  useLinearSettings,
  linearScopeKey,
  defaultLinearFilter,
  type LinearFilter,
} from "./useLinearSettings";
import type { Draft, DraftKey } from "../shared/state";
import { LinearBulkActions } from "./LinearBulkActions";
import { LinearDetail } from "./LinearDetail";
import { SingleSelect } from "./SingleSelect";
import {
  InlineSkeleton,
  IssueDetailSkeleton,
  IssueListSkeleton,
  WorkspaceSkeleton,
} from "./LoadingSkeleton";
import { AnimatedDialogBackdrop } from "./AnimatedDialogBackdrop";
import { selectionIssueData, isTextSelectionClick } from "./SelectionShare";
import { isSavedReceipt } from "./linear-run";
import "./linear.css";
import { isIssueUrlInput, linearIssueUrl } from "../shared/issue-url";
import { DisclosureSummary } from "./DisclosureSummary";

export const linearRef = (issue: LinearRef): LinearRef => ({
  connectionId: issue.connectionId,
  workspaceId: issue.workspaceId,
  teamId: issue.teamId,
  issueId: issue.issueId,
});
type ViewMemory = {
  selected: LinearRef | null;
  showDetail: boolean;
  selections: Map<string, LinearRef>;
  positions: Map<string, number>;
  receipt: (LinearSavedReceipt & { requestId: string }) | null;
};
const retainedViews = new WeakMap<ArcoHost, ViewMemory>();
function viewFor(host: ArcoHost): ViewMemory {
  let view = retainedViews.get(host);
  if (!view) {
    const restored = host.sharedIssue?.();
    const shared = restored?.source === "linear" ? linearRef(restored) : null;
    view = {
      selected: shared,
      showDetail: false,
      selections: new Map(),
      positions: new Map(),
      receipt: null,
    };
    retainedViews.set(host, view);
  }
  return view;
}
const retainedRequests = new WeakMap<ArcoHost, Map<string, string>>();
function requestsFor(host: ArcoHost) {
  let requests = retainedRequests.get(host);
  if (!requests) {
    requests = new Map();
    retainedRequests.set(host, requests);
  }
  return requests;
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const linearDataKeys = new Set([
  "linear-scopes",
  "linear-metadata",
  "linear-templates",
  "linear-issues",
  "linear-issue",
]);

export function LinearWorkspace({
  host,
  onSourceChange,
}: {
  host: ArcoHost;
  onSourceChange: (source: "github" | "linear") => void;
}) {
  const cache = useQueryClient();
  const view = useMemo(() => viewFor(host), [host]);
  const settings = useLinearSettings(host);
  const persistence = useDraftPersistence(host);
  const { load } = persistence;
  const [teamOverride, setTeamOverride] = useState(view.selected?.teamId ?? "");
  const [selected, setSelected] = useState<LinearRef | null>(view.selected);
  const [shared, setShared] = useState<LinearRef | null>(() => {
    const current = host.sharedIssue?.();
    return current?.source === "linear" ? linearRef(current) : null;
  });
  const [localFilters, setLocalFilters] = useState<
    Record<string, LinearFilter>
  >({});
  const filtersRef = useRef<Record<string, LinearFilter>>({});
  const selectionByScope = useRef(view.selections);
  const [mode, setMode] = useState<DisplayMode>(host.mode());
  const [showDetail, setShowDetail] = useState(view.showDetail);
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState(view.receipt);
  const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const lock = useRef(false);
  const requests = useMemo(() => requestsFor(host), [host]);
  const search = useRef<HTMLInputElement>(null);
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
  const list = useRef<HTMLDivElement>(null);
  const positions = useRef(view.positions);
  const restoredScope = useRef<string | null>(null);
  const [bulk, setBulk] = useState<string[]>([]);
  const selectedStateTypes = useRef(new Map<string, string>());
  const [createOpen, setCreateOpen] = useState(false);
  type CreateDraft = {
    title: string;
    body: string;
    templateId: string;
    descriptionTouched: boolean;
  };
  const [createDrafts, setCreateDrafts] = useState<Record<string, CreateDraft>>(
    {},
  );
  const createRef = useRef<Record<string, CreateDraft>>({});
  useEffect(() => {
    view.selected = selected;
    view.showDetail = showDetail;
  }, [view, selected, showDetail]);
  const [clientId, setClientId] = useState("210cd7ed4e0167355328ba0bb627b38c");
  const [authPending, setAuthPending] = useState(false);
  const connection = useQuery({
    queryKey: ["linear-connection"],
    queryFn: () => host.call<LinearConnection>("linear_connection", {}),
    enabled: !disconnecting,
  });
  const connected = connection.data?.connected === true;
  const canRead = connected && !disconnecting;
  const auth = useQuery({
    queryKey: ["linear-auth"],
    queryFn: () =>
      host.call<{ state: string; message: string }>("linear_auth_status", {}),
    enabled: !disconnecting,
    refetchInterval: authPending && !disconnecting ? 2000 : false,
  });
  useEffect(() => {
    if (!disconnecting && auth.data?.state === "connected") {
      setAuthPending(false);
      void cache.invalidateQueries({ queryKey: ["linear-connection"] });
    }
  }, [auth.data?.state, cache, disconnecting]);
  const scopes = useQuery({
    queryKey: [
      "linear-scopes",
      connection.data?.connectionId,
      connection.data?.workspace?.id,
      connection.data?.userId,
    ],
    queryFn: () =>
      host.call<LinearScopes>("linear_scopes", {
        connectionId: connection.data!.connectionId,
      }),
    enabled: canRead,
  });
  const savedTeam = settings.query.data?.settings.activeLinearTeam;
  const teamId =
    (scopes.data?.teams.some((team) => team.id === teamOverride)
      ? teamOverride
      : undefined) ||
    (scopes.data?.teams.some((team) => team.id === savedTeam)
      ? savedTeam
      : undefined) ||
    scopes.data?.teams[0]?.id ||
    "";
  const scope: LinearScope | null = useMemo(
    () =>
      connected &&
      scopes.data &&
      scopes.data.workspace.id === connection.data?.workspace?.id &&
      teamId
        ? {
            connectionId: connection.data?.connectionId ?? "default",
            workspaceId: scopes.data.workspace.id,
            teamId,
          }
        : null,
    [
      connected,
      scopes.data,
      teamId,
      connection.data?.connectionId,
      connection.data?.workspace?.id,
    ],
  );
  const scopeId = scope ? linearScopeKey(scope) : "";
  const currentFilter =
    localFilters[scopeId] ??
    settings.query.data?.settings.linearFilters[scopeId] ??
    defaultLinearFilter;
  const { query, ...filters } = currentFilter;
  const updateFilter = (patch: Partial<LinearFilter>) => {
    const next = {
      ...(filtersRef.current[scopeId] ?? currentFilter),
      ...patch,
    };
    filtersRef.current = { ...filtersRef.current, [scopeId]: next };
    setLocalFilters(filtersRef.current);
    if (scope) settings.saveFilter(scope, next);
  };
  const setQuery = (query: string) => updateFilter({ query });
  const setFilters = (
    update: (
      current: Omit<LinearFilter, "query">,
    ) => Omit<LinearFilter, "query">,
  ) => {
    const current = filtersRef.current[scopeId] ?? currentFilter;
    updateFilter(
      update({
        stateId: current.stateId,
        assigneeId: current.assigneeId,
        labelId: current.labelId,
        projectId: current.projectId,
        order: current.order,
      }),
    );
  };
  const createDraft = createDrafts[scopeId] ?? {
    title: "",
    body: "",
    templateId: "",
    descriptionTouched: false,
  };
  const createKey = useMemo<DraftKey | null>(
    () =>
      scope
        ? {
            source: "linear",
            workspaceId: scope.workspaceId,
            teamId: scope.teamId,
            issue: "new",
          }
        : null,
    [scope],
  );
  useEffect(() => {
    if (!createOpen || !createKey) return;
    void load(createKey).then((saved) => {
      if (!saved || createRef.current[scopeId]) return;
      createRef.current = {
        ...createRef.current,
        [scopeId]: {
          title: saved.title,
          body: saved.body,
          templateId: saved.linearTemplateId ?? "",
          descriptionTouched: saved.linearDescriptionTouched ?? false,
        },
      };
      setCreateDrafts(createRef.current);
    });
  }, [createOpen, createKey, scopeId, load]);
  const setCreateDraft = (
    update: CreateDraft | ((current: CreateDraft) => CreateDraft),
  ) => {
    const current = createRef.current[scopeId] ?? createDraft;
    const next = typeof update === "function" ? update(current) : update;
    createRef.current = { ...createRef.current, [scopeId]: next };
    setCreateDrafts(createRef.current);
    if (createKey)
      persistence.schedule(createKey, {
        title: next.title,
        body: next.body,
        comment: "",
        linearTemplateId: next.templateId || undefined,
        linearDescriptionTouched: next.descriptionTouched,
      });
  };
  const metadata = useQuery({
    queryKey: ["linear-metadata", scope],
    queryFn: () => host.call<LinearMetadata>("linear_metadata", { ...scope }),
    enabled: canRead && Boolean(scope),
  });
  const templates = useQuery({
    queryKey: ["linear-templates", scope],
    queryFn: () =>
      host.call<{ templates: LinearTemplate[] }>("linear_templates", {
        ...scope,
      }),
    enabled: canRead && Boolean(scope) && createOpen,
  });
  const selectedTemplate = templates.data?.templates.find(
    (template) => template.id === createDraft.templateId,
  );
  const pageScope = JSON.stringify([scope, query, filters]);
  const issues = useInfiniteQuery({
    queryKey: ["linear-issues", pageScope],
    refetchInterval: canRead && mode === "fullscreen" ? 30_000 : false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      host.call<LinearPage>("linear_list_issues", {
        ...scope,
        query,
        ...Object.fromEntries(
          Object.entries(filters).filter(([, value]) => value),
        ),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) =>
      last.hasMore ? (last.cursor ?? undefined) : undefined,
    enabled: canRead && Boolean(scope) && !settings.query.isPending,
  });
  const rows = useMemo(
    () => issues.data?.pages.flatMap((page) => page.issues) ?? [],
    [issues.data],
  );
  const matchesConnection = (ref: LinearRef | null) =>
    ref?.connectionId === connection.data?.connectionId &&
    ref?.workspaceId === connection.data?.workspace?.id;
  const active = connected
    ? matchesConnection(selected)
      ? selected
      : rows[0]
        ? linearRef(rows[0])
        : null
    : null;
  const detail = useQuery({
    queryKey: ["linear-issue", active],
    refetchInterval:
      canRead && (mode === "fullscreen" || !shared) ? 30_000 : false,
    queryFn: () => host.call<LinearIssue>("linear_get_issue", { ...active }),
    enabled: canRead && Boolean(active),
  });
  const sharedIssue = useQuery({
    queryKey: ["linear-issue", shared],
    refetchInterval:
      canRead && matchesConnection(shared) && mode !== "fullscreen" && shared
        ? 30_000
        : false,
    queryFn: () => host.call<LinearIssue>("linear_get_issue", { ...shared }),
    enabled: canRead && Boolean(shared) && matchesConnection(shared),
  });
  const detailScope = useMemo(
    () =>
      active
        ? {
            connectionId: active.connectionId,
            workspaceId: active.workspaceId,
            teamId: active.teamId,
          }
        : null,
    [active],
  );
  const detailMetadata = useQuery({
    queryKey: ["linear-metadata", detailScope],
    queryFn: () =>
      host.call<LinearMetadata>("linear_metadata", { ...detailScope }),
    enabled: canRead && Boolean(detailScope),
  });
  const retained = shared
    ? matchesConnection(shared)
      ? sharedIssue.data
      : undefined
    : detail.data;
  useEffect(
    () =>
      host.subscribe((event) => {
        if (event === "context") {
          const restored = host.sharedIssue?.();
          setShared(restored?.source === "linear" ? linearRef(restored) : null);
          return;
        }
        setMode(host.mode());
        if (event === "data" && canRead)
          void cache.invalidateQueries(
            {
              predicate: (entry) =>
                ["linear-issue", "linear-issues", "linear-metadata"].includes(
                  String(entry.queryKey[0]),
                ),
            },
            { cancelRefetch: false },
          );
      }),
    [host, cache, canRead],
  );
  useEffect(() => {
    if (canRead && !selected && rows[0]) setSelected(linearRef(rows[0]));
  }, [canRead, selected, rows]);
  useLayoutEffect(() => {
    if (!issues.isSuccess || !list.current) {
      restoredScope.current = null;
      return;
    }
    const scopeKey = `${mode}:${pageScope}`;
    if (restoredScope.current !== scopeKey) {
      list.current.scrollTop = positions.current.get(pageScope) ?? 0;
      restoredScope.current = scopeKey;
    }
  }, [pageScope, issues.isSuccess, mode]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            "input,textarea,select,[contenteditable=true],[role=dialog],[role=button]",
          )) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape") setShowDetail(false);
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const index = rows.findIndex(
          (issue) => issue.issueId === active?.issueId,
        );
        const next =
          rows[
            Math.max(
              0,
              Math.min(rows.length - 1, index + (event.key === "j" ? 1 : -1)),
            )
          ];
        if (next) {
          setSelected(linearRef(next));
          setShowDetail(true);
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [rows, active]);
  async function run<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T | LinearSavedReceipt | undefined> {
    if (lock.current || !connected) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    const key = JSON.stringify([name, args]);
    const requestId = requests.get(key) ?? crypto.randomUUID();
    requests.set(key, requestId);
    try {
      const result = await host.call<T | LinearSavedReceipt>(name, {
        ...args,
        requestId,
      });
      requests.delete(key);
      if (isSavedReceipt(result)) {
        const saved = { ...result, requestId };
        view.receipt = saved;
        view.selected = linearRef(result);
        view.showDetail = true;
        setReceipt(saved);
        setSelected(linearRef(result));
        setShowDetail(true);
        void cache.invalidateQueries({ queryKey: ["linear-issue"] });
        void cache.invalidateQueries({ queryKey: ["linear-issues"] });
        return result;
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["linear-issue"] }),
        cache.invalidateQueries({ queryKey: ["linear-issues"] }),
        cache.invalidateQueries({ queryKey: ["linear-metadata"] }),
      ]);
      setNotice(
        connection.data?.mode === "fixture"
          ? "Updated and refetched Linear fixture."
          : "Saved to Linear and refetched.",
      );
      return result;
    } catch (error) {
      setNotice(message(error));
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["linear-issue"] }),
        cache.invalidateQueries({ queryKey: ["linear-issues"] }),
        cache.invalidateQueries({ queryKey: ["linear-metadata"] }),
      ]);
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function hostAction(action: () => Promise<void>, success: string) {
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setNotice(message(error));
    }
  }
  function disconnected(connectionId: string) {
    cache.setQueryData<LinearConnection>(["linear-connection"], {
      connectionId,
      connected: false,
      mode: "linear",
      account: null,
      userId: null,
      workspace: null,
      message: "Authorize Arco with Linear to connect.",
    });
    cache.setQueryData(["linear-auth"], {
      state: "idle",
      connected: false,
      message: "",
    });
    cache.removeQueries({
      predicate: (entry) => linearDataKeys.has(String(entry.queryKey[0])),
    });
    setAuthPending(false);
    setTeamOverride("");
    setSelected(null);
    setShowDetail(false);
    setCreateOpen(false);
    setBulk([]);
    setReceipt(null);
    view.selected = null;
    view.showDetail = false;
    view.receipt = null;
    selectionByScope.current.clear();
    selectedStateTypes.current.clear();
    setNotice(
      "Disconnected Linear on this device. Your drafts and chat context are preserved.",
    );
  }
  async function disconnect() {
    if (lock.current || connection.data?.mode === "fixture") return;
    lock.current = true;
    setBusy(true);
    setDisconnecting(true);
    setNotice("");
    urlRequest.current += 1;
    setUrlBusy(false);
    setSearchEntry(null);
    setSearchError("");
    const connectionId = connection.data?.connectionId ?? "default";
    try {
      await cache.cancelQueries({
        predicate: (entry) => String(entry.queryKey[0]).startsWith("linear-"),
      });
      const result = await host.call<{ disconnected: boolean }>(
        "linear_auth_disconnect",
        { connectionId, revoke: false },
      );
      if (!result.disconnected)
        throw new Error("Linear disconnection was not confirmed.");
      disconnected(connectionId);
    } catch (error) {
      // The local credential may already be gone if the acknowledgement was lost.
      const status = await host
        .call<{ connected: boolean }>("linear_auth_status", { connectionId })
        .catch(() => null);
      if (status?.connected === false) disconnected(connectionId);
      else setNotice(message(error));
    } finally {
      lock.current = false;
      setDisconnecting(false);
      setBusy(false);
      accountMenu.current?.querySelector("summary")?.focus();
    }
  }
  const changeMode = (value: "inline" | "fullscreen") => {
    capturePosition();
    return hostAction(async () => {
      await host.display(value);
      setMode(host.mode());
    }, "Display mode updated.");
  };
  const openRetainedDetails = () => {
    if (retained) {
      setSelected(linearRef(retained));
      setShowDetail(true);
    }
    void changeMode("fullscreen");
  };
  const capturePosition = () => {
    if (
      list.current &&
      issues.isSuccess &&
      restoredScope.current === `${mode}:${pageScope}`
    )
      positions.current.set(pageScope, list.current.scrollTop);
  };
  const openIssueUrl = async (value: string) => {
    const request = ++urlRequest.current;
    setUrlBusy(true);
    setSearchError("");
    try {
      linearIssueUrl(value);
      if (lock.current)
        throw new Error(
          "Wait for the current change before opening another issue.",
        );
      const resolved = await host.call<LinearRef>("linear_resolve_issue", {
        connectionId: connection.data?.connectionId ?? "default",
        url: value,
      });
      if (request !== urlRequest.current) return;
      const issue = await host.call<LinearIssue>("linear_get_issue", {
        ...resolved,
      });
      if (request !== urlRequest.current) return;
      if (
        issue.issueId !== resolved.issueId ||
        issue.teamId !== resolved.teamId ||
        issue.workspaceId !== resolved.workspaceId ||
        issue.connectionId !== resolved.connectionId
      )
        throw new Error(
          "Linear returned a different issue than the resolved URL.",
        );
      capturePosition();
      if (selected && scope) selectionByScope.current.set(scopeId, selected);
      cache.setQueryData(["linear-issue", resolved], issue);
      setTeamOverride(resolved.teamId);
      setSelected(resolved);
      settings.selectTeam(
        resolved,
        scopes.data?.teams.find((team) => team.id === resolved.teamId)?.name ??
          resolved.teamId,
      );
      setShowDetail(true);
      setSearchEntry(null);
    } catch (error) {
      if (request === urlRequest.current) setSearchError(message(error));
    } finally {
      if (request === urlRequest.current) setUrlBusy(false);
    }
  };

  const detailFeedback = (
    <>
      {connection.data?.mode === "fixture" && (
        <div className="fixture-banner">
          LOCAL LINEAR FIXTURE · No writes to Linear
        </div>
      )}
      {connected && notice && (
        <div className="notice" role="status">
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss Linear notice"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {receipt && (
        <section
          className="notice linear-saved-receipt"
          aria-label="Saved Linear receipt"
          role="status"
        >
          <div>
            <strong>Saved in Linear</strong>
            <p>{receipt.message}</p>
            <p>
              Issue ID: {receipt.issueId}
              {receipt.commentId ? ` · Comment ID: ${receipt.commentId}` : ""}
            </p>
            <details>
              <DisclosureSummary>Request receipt</DisclosureSummary>
              <code>{receipt.requestId}</code>
            </details>
            <button
              className="text-button"
              onClick={() => {
                setSelected(linearRef(receipt));
                setShowDetail(true);
                void cache.invalidateQueries({ queryKey: ["linear-issue"] });
                void cache.invalidateQueries({ queryKey: ["linear-issues"] });
              }}
            >
              Check saved issue
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss saved Linear receipt"
            onClick={() => {
              view.receipt = null;
              setReceipt(null);
            }}
          >
            ×
          </button>
        </section>
      )}
      {detail.isError && detail.data && (
        <div className="notice error" role="alert">
          <span>
            <strong>Could not refresh this issue.</strong> Showing the last
            loaded version. {message(detail.error)}
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
    </>
  );

  const checkingConnection = connection.isPending && !connection.data;
  const detailLoading =
    !detail.data &&
    canRead &&
    ((Boolean(active) && detail.isPending) ||
      (!active && Boolean(scope) && issues.isPending));
  const resolvingWorkspace =
    canRead && ((scopes.isPending && !scopes.data) || settings.query.isPending);
  if (checkingConnection || resolvingWorkspace)
    return (
      <WorkspaceSkeleton
        mode={mode}
        label={
          checkingConnection
            ? "Checking Linear connection"
            : "Loading Linear workspace"
        }
      />
    );

  if (
    mode !== "fullscreen" &&
    connected &&
    !retained &&
    ((shared && matchesConnection(shared) && sharedIssue.isPending) ||
      (!shared && active && detail.isPending) ||
      (!active && scope && issues.isPending))
  )
    return <InlineSkeleton />;

  if (mode !== "fullscreen" && connection.data?.connected && retained)
    return (
      <main
        className="arco compact-mode inline-mode"
        data-arco-issue={selectionIssueData(retained)}
        aria-busy={shared ? sharedIssue.isFetching : detail.isFetching}
      >
        <div className="compact-top">
          <strong>Arco · Linear</strong>
          <span className="muted">{shared ? "Chat context" : "Browsing"}</span>
          <button
            className="icon-button"
            aria-label="Expand Linear view"
            onClick={openRetainedDetails}
          >
            ↗
          </button>
        </div>
        <div className="issue-kicker">
          <span style={{ color: retained.state.color }}>◉</span>
          {retained.identifier}
          <span>{retained.state.name}</span>
        </div>
        <h1>{retained.title}</h1>
        <p className="muted">{retained.body.slice(0, 140)}</p>
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          onClick={openRetainedDetails}
        >
          Open details
        </Button>
        {notice && <p role="status">{notice}</p>}
      </main>
    );
  if (mode !== "fullscreen") {
    const failure =
      connection.error ||
      scopes.error ||
      sharedIssue.error ||
      detail.error ||
      issues.error;
    return (
      <main className="arco compact-mode inline-mode">
        <div className="compact-top">
          <strong>Arco · Linear</strong>
        </div>
        <h1>
          {failure
            ? "Could not load Linear"
            : !connected
              ? "Connect Linear"
              : !scope
                ? "No Linear teams available"
                : "Select a Linear Issue"}
        </h1>
        <p className="muted" role={failure ? "alert" : undefined}>
          {failure
            ? message(failure)
            : "Open the workspace to connect Linear or browse your issues."}
        </p>
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          onClick={openRetainedDetails}
        >
          Open details
        </Button>
        {notice && <p role="status">{notice}</p>}
      </main>
    );
  }
  return (
    <main
      className={`arco workspace linear-workspace ${showDetail ? "show-detail" : ""}`}
    >
      <aside className="issue-sidebar" aria-label="Linear Issue list">
        <div className="sidebar-heading">
          <div className="sidebar-identity">
            <strong className="wordmark">Arco</strong>
            <SingleSelect
              className="source-select"
              label="Issue source"
              value="linear"
              options={[
                { value: "github", label: "GitHub" },
                { value: "linear", label: "Linear" },
              ]}
              onChange={(value) => {
                if (value !== "github") return;
                capturePosition();
                onSourceChange("github");
              }}
            />
          </div>
          <button
            className="icon-button"
            aria-label="Create Linear Issue"
            disabled={!scope || busy}
            onClick={() => setCreateOpen(true)}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        {!connection.data?.connected ? (
          <div className="list-message">
            <strong>Connect Linear</strong>
            <p>
              {connection.error
                ? message(connection.error)
                : connection.data?.message || "Checking Linear authorization."}
            </p>
            <p>
              Enter the Arco OAuth client ID. Credentials are stored in your OS
              credential store.
            </p>
            <label>
              OAuth client ID
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </label>
            <Button
              color="primary"
              disabled={!clientId || busy}
              onClick={() =>
                void hostAction(async () => {
                  const result = await host.call<{ authorizationUrl: string }>(
                    "linear_auth_begin",
                    { connectionId: "default", clientId },
                  );
                  await host.openLink(result.authorizationUrl);
                  setAuthPending(true);
                }, "Opened Linear authorization. Review the workspace and permissions.")
              }
            >
              Authorize in Linear
            </Button>
            <p>{auth.data?.message}</p>
            {notice && <p role="status">{notice}</p>}
            <button
              className="text-button"
              onClick={() => {
                void connection.refetch();
                void auth.refetch();
              }}
            >
              Check connection
            </button>
          </div>
        ) : !scopes.data && scopes.isError ? (
          <div className="list-message" role="alert">
            <strong>Could not load Linear teams</strong>
            <p>{message(scopes.error)}</p>
            <Button
              color="secondary"
              variant="outline"
              disabled={scopes.isFetching}
              onClick={() => void scopes.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : !scope ? (
          <div className="list-message">
            <strong>No Linear teams available</strong>
            <p>Arco could not find an accessible team in this workspace.</p>
            <Button
              color="secondary"
              variant="outline"
              disabled={scopes.isFetching}
              onClick={() => void scopes.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {scopes.isError && (
              <div className="list-message" role="alert">
                <p>Could not refresh Linear teams. {message(scopes.error)}</p>
                <button
                  className="text-button"
                  disabled={scopes.isFetching}
                  onClick={() => void scopes.refetch()}
                >
                  Retry refresh
                </button>
              </div>
            )}
            <label className="linear-team scope-picker">
              <span className="scope-label">
                {scopes.data?.workspace.name || "Workspace"}
              </span>
              <SingleSelect
                className="scope-select"
                label="Linear Team"
                value={teamId}
                disabled={busy}
                options={(scopes.data?.teams ?? []).map((team) => ({
                  value: team.id,
                  label: `${team.name} · ${team.key}`,
                }))}
                onChange={(value) => {
                  urlRequest.current += 1;
                  setUrlBusy(false);
                  setSearchEntry(null);
                  setSearchError("");
                  capturePosition();
                  if (selected && scope)
                    selectionByScope.current.set(scopeId, selected);
                  const nextScope = scope ? { ...scope, teamId: value } : null;
                  setTeamOverride(value);
                  setSelected(
                    nextScope
                      ? (selectionByScope.current.get(
                          linearScopeKey(nextScope),
                        ) ?? null)
                      : null,
                  );
                  if (nextScope)
                    settings.selectTeam(
                      nextScope,
                      scopes.data?.teams.find(
                        (team) => team.id === nextScope.teamId,
                      )?.name ?? nextScope.teamId,
                    );
                  setBulk([]);
                  setShowDetail(false);
                }}
              />
            </label>
            <div className="search-control" aria-busy={urlBusy}>
              <MagnifyingGlassSearch aria-hidden="true" />
              <input
                ref={search}
                aria-label="Search Linear Issues"
                value={searchEntry ?? query}
                aria-describedby={
                  searchError ? "linear-search-error" : undefined
                }
                onChange={(event) => {
                  urlRequest.current += 1;
                  setUrlBusy(false);
                  setSearchError("");
                  capturePosition();
                  const value = event.target.value;
                  if (isIssueUrlInput(value)) setSearchEntry(value);
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
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    isIssueUrlInput(event.currentTarget.value)
                  ) {
                    event.preventDefault();
                    void openIssueUrl(event.currentTarget.value.trim());
                  }
                }}
                placeholder="Search or paste issue URL…"
              />
              <kbd>/</kbd>
            </div>
            {searchError && (
              <p id="linear-search-error" className="inline-error" role="alert">
                {searchError}
              </p>
            )}
            <div className="list-filter">
              <label className="state-select">
                <span className="sr-only">Workflow state</span>
                <SingleSelect
                  label="Linear workflow state"
                  value={filters.stateId}
                  options={[
                    { value: "", label: "All workflow states" },
                    ...(metadata.data?.states ?? []).map((state) => ({
                      value: state.id,
                      label: state.name,
                    })),
                  ]}
                  onChange={(value) => {
                    capturePosition();
                    setFilters((previous) => ({
                      ...previous,
                      stateId: value,
                    }));
                  }}
                />
              </label>
              <button
                className="icon-button"
                aria-label="Refresh Linear"
                title="Refresh issues"
                disabled={issues.isFetching}
                onClick={() =>
                  void cache.invalidateQueries({
                    predicate: (entry) =>
                      String(entry.queryKey[0]).startsWith("linear-"),
                  })
                }
              >
                <ArrowRotateCw aria-hidden="true" />
              </button>
            </div>
            <details className="linear-filters sidebar-filters">
              <DisclosureSummary>
                <Filter aria-hidden="true" />
                Filters
              </DisclosureSummary>
              {(["assigneeId", "labelId", "projectId"] as const).map((key) => (
                <label key={key}>
                  {
                    {
                      assigneeId: "Assignee",
                      labelId: "Labels",
                      projectId: "Project",
                    }[key]
                  }
                  <SingleSelect
                    label={
                      {
                        assigneeId: "Assignee",
                        labelId: "Labels",
                        projectId: "Project",
                      }[key]
                    }
                    value={filters[key]}
                    options={[
                      { value: "", label: "All" },
                      ...(
                        (key === "assigneeId"
                          ? metadata.data?.members
                          : key === "labelId"
                            ? metadata.data?.labels.filter(
                                (label) => !label.isGroup,
                              )
                            : metadata.data?.projects) ?? []
                      ).map((item) => ({ value: item.id, label: item.name })),
                    ]}
                    onChange={(value) => {
                      capturePosition();
                      setFilters((previous) => ({
                        ...previous,
                        [key]: value,
                      }));
                    }}
                  />
                </label>
              ))}
              <label>
                Sort
                <SingleSelect
                  label="Sort"
                  value={filters.order}
                  options={[
                    { value: "updatedAt", label: "Recently updated" },
                    { value: "createdAt", label: "Recently created" },
                  ]}
                  onChange={(value) => {
                    capturePosition();
                    setFilters((previous) => ({
                      ...previous,
                      order: value === "createdAt" ? "createdAt" : "updatedAt",
                    }));
                  }}
                />
              </label>
              <p>
                Search within the selected team. Workflow states and properties
                come from Linear.
              </p>
            </details>
            <div className="list-caption">
              <span>
                {issues.isFetching
                  ? "Loading…"
                  : `${rows.length}${issues.hasNextPage ? "+" : ""} Issues`}
              </span>
            </div>
            {bulk.length > 0 && scope && (
              <LinearBulkActions
                key={JSON.stringify(scope)}
                scope={scope}
                ids={bulk}
                metadata={metadata.data}
                hasDuplicate={bulk.some(
                  (id) =>
                    (rows.find((issue) => issue.issueId === id)?.state.type ??
                      selectedStateTypes.current.get(id)) === "duplicate",
                )}
                busy={busy}
                run={run}
                onClear={() => setBulk([])}
              />
            )}
            <div
              className="issue-list"
              ref={list}
              aria-busy={issues.isFetching}
              onScroll={() => {
                if (issues.isSuccess) capturePosition();
              }}
            >
              {issues.isPending && <IssueListSkeleton />}
              {rows.map((issue) => (
                <div className="linear-list-row" key={issue.issueId}>
                  <input
                    type="checkbox"
                    aria-label={`${issue.identifier} — select for bulk actions`}
                    checked={bulk.includes(issue.issueId)}
                    disabled={busy}
                    onChange={(event) => {
                      selectedStateTypes.current.set(
                        issue.issueId,
                        issue.state.type,
                      );
                      setBulk((previous) =>
                        event.target.checked
                          ? [...previous, issue.issueId]
                          : previous.filter((id) => id !== issue.issueId),
                      );
                    }}
                  />
                  <button
                    className={`issue-row ${active?.issueId === issue.issueId ? "selected" : ""}`}
                    data-arco-issue={selectionIssueData(issue)}
                    onClick={(event) => {
                      if (
                        event.detail > 0 &&
                        isTextSelectionClick(event.currentTarget)
                      )
                        return;
                      setSelected(linearRef(issue));
                      setShowDetail(true);
                    }}
                  >
                    <span style={{ color: issue.state.color }}>◉</span>
                    <span className="row-content">
                      <span className="row-title">{issue.title}</span>
                      <span className="row-meta">
                        {issue.identifier} · {issue.state.name}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
              {issues.isError && (
                <div role="alert" className="list-message">
                  <p className="inline-error">{message(issues.error)}</p>
                  <button
                    className="text-button"
                    disabled={issues.isFetching}
                    onClick={() => void issues.refetch()}
                  >
                    Retry
                  </button>
                </div>
              )}
              {issues.isSuccess && !rows.length && (
                <p className="list-message">No matching Issues.</p>
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
          </>
        )}
        {(settings.query.isError || settings.error) && (
          <p className="inline-error settings-error" role="alert">
            Could not save Linear display settings:{" "}
            {settings.error || settings.query.error?.message}
          </p>
        )}
        <footer className="sidebar-footer sidebar-account">
          {connection.data?.mode === "fixture" ? (
            <span className="connection-line">
              <span className="connection-dot connected" />
              {connection.data.account} · Linear fixture
            </span>
          ) : (
            <details
              className="linear-account-menu"
              ref={accountMenu}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }}
            >
              <summary
                className="connection-line"
                aria-label="Linear connection actions"
              >
                <span
                  className={`connection-dot ${connected ? "connected" : ""}`}
                />
                <span className="disclosure-label">
                  {connection.data?.account ||
                    (connection.isError
                      ? "Connection unavailable"
                      : "Disconnected")}
                </span>
                <DotsHorizontalMoreMenu aria-hidden="true" />
              </summary>
              <div className="detail-utility-menu">
                <button
                  className="utility-item"
                  disabled={
                    busy || (!connected && !authPending && !connection.isError)
                  }
                  onClick={() => {
                    if (accountMenu.current) accountMenu.current.open = false;
                    void disconnect();
                  }}
                >
                  Disconnect Linear
                </button>
              </div>
            </details>
          )}
        </footer>
      </aside>
      <section
        className="detail-pane"
        aria-label="Linear Issue details"
        aria-busy={(canRead && detail.isFetching) || detailLoading}
        data-arco-issue={
          connected && detail.data ? selectionIssueData(detail.data) : undefined
        }
      >
        {(!connected || !detail.data) && (
          <>
            <header className="detail-toolbar">
              <span className="toolbar-tab">Linear Issue</span>
            </header>
            {detailFeedback}
          </>
        )}
        {connected && detail.data ? (
          <LinearDetail
            key={`${detail.data.connectionId}/${detail.data.issueId}`}
            host={host}
            issue={detail.data}
            feedback={detailFeedback}
            shared={
              shared
                ? {
                    ...shared,
                    identifier: sharedIssue.data?.identifier ?? shared.issueId,
                  }
                : null
            }
            onBack={() => setShowDetail(false)}
            onFullscreen={() => void changeMode("fullscreen")}
            metadata={detailMetadata.data}
            metadataError={detailMetadata.error}
            connection={connection.data}
            busy={busy}
            run={run}
            onNotice={setNotice}
          />
        ) : detailLoading ? (
          <IssueDetailSkeleton />
        ) : detail.isError && active ? (
          <div className="empty-state" role="alert">
            <strong>Could not load this issue</strong>
            <p>{message(detail.error)}</p>
            <Button
              color="secondary"
              variant="outline"
              onClick={() => void detail.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="empty-state">
            <h1>Select a Linear Issue</h1>
            <p>Work with native workflow states and properties inside Codex.</p>
          </div>
        )}
      </section>
      {scope && (
        <AnimatedDialogBackdrop open={createOpen}>
          <section
            className="create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="linear-create-title"
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                (event.target instanceof Element &&
                  event.target.closest('[role="dialog"]') !==
                    event.currentTarget)
              )
                return;
              if (event.key === "Escape" && !busy) {
                event.stopPropagation();
                setCreateOpen(false);
              }
              if (event.key === "Tab") {
                const elements = [
                  ...event.currentTarget.querySelectorAll<HTMLElement>(
                    'button:not(:disabled):not([tabindex="-1"]),input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]),textarea:not(:disabled):not([tabindex="-1"]),[role="button"][tabindex="0"]:not([aria-disabled="true"])',
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
            <h2 id="linear-create-title">Create Linear Issue</h2>
            <p className="muted">
              {scopes.data?.workspace.name} /{" "}
              {
                scopes.data?.teams.find((team) => team.id === scope.teamId)
                  ?.name
              }
            </p>
            {createKey && (
              <DraftStatus
                status={persistence.statuses[draftStorageId(createKey)]}
                onRetry={() =>
                  persistence.retry(createKey, {
                    title: createDraft.title,
                    body: createDraft.body,
                    comment: "",
                    linearTemplateId: createDraft.templateId || undefined,
                    linearDescriptionTouched: createDraft.descriptionTouched,
                  })
                }
                onResolve={(choice) => {
                  const local: Draft = {
                    title: createDraft.title,
                    body: createDraft.body,
                    comment: "",
                    linearTemplateId: createDraft.templateId || undefined,
                    linearDescriptionTouched: createDraft.descriptionTouched,
                  };
                  void persistence
                    .resolve(createKey, choice, local)
                    .then((saved) => {
                      if (saved === undefined) return;
                      createRef.current = {
                        ...createRef.current,
                        [scopeId]: saved
                          ? {
                              title: saved.title,
                              body: saved.body,
                              templateId: saved.linearTemplateId ?? "",
                              descriptionTouched:
                                saved.linearDescriptionTouched ?? false,
                            }
                          : {
                              title: "",
                              body: "",
                              templateId: "",
                              descriptionTouched: false,
                            },
                      };
                      setCreateDrafts(createRef.current);
                    });
                }}
              />
            )}
            <label>
              Template
              <SingleSelect
                label="Linear template"
                value={createDraft.templateId}
                disabled={busy}
                options={[
                  { value: "", label: "None" },
                  ...(templates.data?.templates ?? []).map((template) => ({
                    value: template.id,
                    label: `${template.name}${
                      !template.supported
                        ? ` · Create in Linear: ${template.reason}`
                        : ""
                    }`,
                  })),
                ]}
                onChange={(value) => {
                  const nextTemplate = templates.data?.templates.find(
                    (template) => template.id === value,
                  );
                  setCreateDraft((previous) => {
                    if (!nextTemplate?.supported)
                      return { ...previous, templateId: value };
                    const previousTemplate = templates.data?.templates.find(
                      (template) => template.id === previous.templateId,
                    );
                    return {
                      ...previous,
                      templateId: nextTemplate.id,
                      title:
                        !previous.title ||
                        previous.title === previousTemplate?.defaults?.title
                          ? (nextTemplate.defaults?.title ?? previous.title)
                          : previous.title,
                      body: previous.descriptionTouched
                        ? previous.body
                        : (nextTemplate.defaults?.body ?? ""),
                    };
                  });
                }}
              />
            </label>
            {templates.isPending && (
              <p className="muted" role="status">
                Loading templates…
              </p>
            )}
            {templates.isError && (
              <p className="inline-error" role="alert">
                {templates.error.message}
              </p>
            )}
            {selectedTemplate && (
              <section className="linear-template-preview">
                <p className="muted">{selectedTemplate.description}</p>
                {selectedTemplate.supported ? (
                  <>
                    <p className="property-note">
                      Untouched descriptions use the template default. Editing
                      the description overrides it.
                    </p>
                    <LinearTemplateDefaults
                      template={selectedTemplate}
                      metadata={metadata.data}
                    />
                  </>
                ) : (
                  <>
                    <p className="inline-error">
                      {selectedTemplate.reason ||
                        "This template needs the official Linear flow."}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        const url = new URL("https://linear.app/new");
                        url.searchParams.set("team", scope.teamId);
                        url.searchParams.set("template", selectedTemplate.id);
                        void hostAction(
                          () => host.openLink(url.href),
                          "Opened Linear to use the template.",
                        );
                      }}
                    >
                      Open Linear to use this template ↗
                    </button>
                  </>
                )}
              </section>
            )}
            <label>
              Title
              <input
                autoFocus
                value={createDraft.title}
                disabled={busy}
                onChange={(event) =>
                  setCreateDraft((previous) => ({
                    ...previous,
                    title: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Markdown description
              <textarea
                rows={8}
                value={createDraft.body}
                disabled={busy}
                onChange={(event) =>
                  setCreateDraft((previous) => ({
                    ...previous,
                    body: event.target.value,
                    descriptionTouched: true,
                  }))
                }
              />
            </label>
            <div className="dialog-actions">
              <Button
                color="secondary"
                variant="ghost"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
              >
                Close
              </Button>
              <Button
                color="primary"
                disabled={
                  busy ||
                  !createDraft.title.trim() ||
                  Boolean(
                    createDraft.templateId && !selectedTemplate?.supported,
                  )
                }
                onClick={() =>
                  void run<LinearIssue>("linear_create_issue", {
                    ...scope,
                    title: createDraft.title,
                    ...(!createDraft.templateId ||
                    createDraft.descriptionTouched
                      ? { body: createDraft.body }
                      : {}),
                    ...(createDraft.templateId
                      ? { templateId: createDraft.templateId }
                      : {}),
                  }).then((result) => {
                    if (result?.issueId) {
                      setSelected(linearRef(result));
                      setShowDetail(true);
                      setCreateOpen(false);
                      setCreateDraft({
                        title: "",
                        body: "",
                        templateId: "",
                        descriptionTouched: false,
                      });
                    }
                  })
                }
              >
                Create in Linear
              </Button>
            </div>
          </section>
        </AnimatedDialogBackdrop>
      )}
    </main>
  );
}

function LinearTemplateDefaults({
  template,
  metadata,
}: {
  template: LinearTemplate;
  metadata?: LinearMetadata;
}) {
  const defaults = template.defaults;
  if (!defaults) return null;
  const values: [string, string][] = [];
  if (defaults.stateId)
    values.push([
      "Workflow state",
      metadata?.states.find((state) => state.id === defaults.stateId)?.name ??
        "Unavailable in this team",
    ]);
  if (defaults.assigneeId !== undefined)
    values.push([
      "Assignee",
      defaults.assigneeId === null
        ? "Unassigned"
        : (metadata?.members.find((member) => member.id === defaults.assigneeId)
            ?.name ?? "Unavailable in this team"),
    ]);
  if (defaults.priority !== undefined)
    values.push([
      "Priority",
      ["No priority", "Urgent", "High", "Normal", "Low"][defaults.priority],
    ]);
  if (defaults.estimate !== undefined)
    values.push([
      "Estimate",
      defaults.estimate === null ? "Not set" : String(defaults.estimate),
    ]);
  if (defaults.dueDate !== undefined)
    values.push(["Due date", defaults.dueDate ?? "Not set"]);
  if (defaults.labelIds?.length)
    values.push([
      "Labels",
      defaults.labelIds
        .map(
          (id) =>
            metadata?.labels.find((label) => label.id === id)?.name ??
            "Unavailable label",
        )
        .join(", "),
    ]);
  if (defaults.projectId !== undefined)
    values.push([
      "Project",
      defaults.projectId === null
        ? "None"
        : (metadata?.projects.find(
            (project) => project.id === defaults.projectId,
          )?.name ?? "Unavailable Project"),
    ]);
  if (defaults.projectMilestoneId !== undefined)
    values.push([
      "Project milestone",
      defaults.projectMilestoneId === null
        ? "None"
        : (metadata?.milestones.find(
            (milestone) => milestone.id === defaults.projectMilestoneId,
          )?.name ?? "Unavailable milestone"),
    ]);
  if (defaults.cycleId !== undefined)
    values.push([
      "Cycle",
      defaults.cycleId === null
        ? "None"
        : (metadata?.cycles.find((cycle) => cycle.id === defaults.cycleId)
            ?.name ?? "Unavailable cycle"),
    ]);
  return values.length ? (
    <details>
      <DisclosureSummary>Initial template attributes</DisclosureSummary>
      <dl>
        {values.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  ) : null;
}
