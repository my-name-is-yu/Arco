import { useId, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type {
  ArcoHost,
  Connection,
  Label,
  RepositoryPage,
} from "../shared/contracts";
import type {
  LinearConnection,
  LinearMetadata,
  LinearScopes,
} from "../shared/linear";
import {
  symphonyBaseUrlSchema,
  symphonyConnectionSchema,
  type SymphonyBinding,
  type SymphonyConnection,
} from "../shared/symphony";
import { CreateDialog } from "./CreateDialog";
import { SingleSelect } from "./SingleSelect";
import { MultiSelect } from "./MultiSelect";
import { IssueStateVisual } from "./IssuePropertyVisual";
import "./symphony-connection-editor.css";

export function SymphonyConnectionEditor({
  host,
  connection,
  onSave,
  onRemove,
  onClose,
}: {
  host: ArcoHost;
  connection?: SymphonyConnection;
  onSave: (connection: SymphonyConnection) => Promise<void>;
  onRemove?: () => Promise<void>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const [id] = useState(() => connection?.id ?? crypto.randomUUID());
  const [name, setName] = useState(connection?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
  const [source, setSource] = useState<"none" | "github" | "linear">(
    connection?.binding?.source ?? "none",
  );
  const githubBinding =
    connection?.binding?.source === "github" ? connection.binding : undefined;
  const linearBinding =
    connection?.binding?.source === "linear" ? connection.binding : undefined;
  const [repo, setRepo] = useState(githubBinding?.repo ?? "");
  const [prepareLabels, setPrepareLabels] = useState(
    githubBinding?.prepareLabels ?? [],
  );
  const [reviewLabels, setReviewLabels] = useState(
    githubBinding?.reviewLabels ?? [],
  );
  const [teamId, setTeamId] = useState(linearBinding?.teamId ?? "");
  const [bindingWorkspaceId, setBindingWorkspaceId] = useState(
    linearBinding?.workspaceId ?? "",
  );
  const [projectId, setProjectId] = useState(linearBinding?.projectId ?? "");
  const [prepareStateIds, setPrepareStateIds] = useState(
    linearBinding?.prepareStateIds ?? [],
  );
  const [reviewStateIds, setReviewStateIds] = useState(
    linearBinding?.reviewStateIds ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testedUrl, setTestedUrl] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const linearConnectionId = linearBinding?.connectionId ?? "default";

  const github = useQuery({
    queryKey: ["connection"],
    queryFn: ({ signal }) =>
      host.call<Connection>("arco_connection", {}, { signal }),
    enabled: source === "github",
    refetchOnMount: "always",
  });
  const githubGeneration = github.data?.authGeneration;
  const repositories = useInfiniteQuery({
    queryKey: ["symphony-connection-repositories", githubGeneration],
    queryFn: ({ pageParam, signal }) =>
      host.call<RepositoryPage>(
        "arco_repositories",
        { page: pageParam },
        { signal },
      ),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: source === "github" && github.data?.connected === true,
  });
  const labels = useQuery({
    queryKey: ["symphony-connection-labels", repo, githubGeneration],
    queryFn: ({ signal }) =>
      host.call<{ repo: string; labels: Label[] }>(
        "arco_label_definitions",
        { repo },
        { signal },
      ),
    enabled: source === "github" && github.data?.connected === true && !!repo,
  });
  const linear = useQuery({
    queryKey: ["linear-connection", linearConnectionId],
    queryFn: ({ signal }) =>
      host.call<LinearConnection>(
        "linear_connection",
        { connectionId: linearConnectionId },
        { signal },
      ),
    enabled: source === "linear",
    refetchOnMount: "always",
  });
  const linearIdentity = [
    linearConnectionId,
    linear.data?.workspace?.id,
    linear.data?.userId,
    linear.data?.authGeneration,
  ];
  const scopes = useQuery({
    queryKey: ["symphony-connection-linear-scopes", ...linearIdentity],
    queryFn: ({ signal }) =>
      host.call<LinearScopes>(
        "linear_scopes",
        { connectionId: linearConnectionId },
        { signal },
      ),
    enabled: source === "linear" && linear.data?.connected === true,
  });
  const workspaceId = scopes.data?.workspace.id;
  const teamExists = scopes.data?.teams.some((team) => team.id === teamId);
  const metadata = useQuery({
    queryKey: [
      "symphony-connection-linear-metadata",
      ...linearIdentity,
      teamId,
    ],
    queryFn: ({ signal }) =>
      host.call<LinearMetadata>(
        "linear_metadata",
        { connectionId: linearConnectionId, workspaceId, teamId },
        { signal },
      ),
    enabled:
      source === "linear" &&
      linear.data?.connected === true &&
      !!workspaceId &&
      teamExists === true,
  });

  const labelOptions =
    labels.data?.labels.map((label) => ({
      value: label.name,
      label: label.name,
      color: `#${label.color}`,
    })) ?? [];
  const stateOptions =
    metadata.data?.states.map((state) => ({
      value: state.id,
      label: state.name,
      leading: (
        <IssueStateVisual
          source="linear"
          state={state.type}
          color={state.color}
        />
      ),
    })) ?? [];
  const catalogError =
    source === "github"
      ? (github.error ?? repositories.error ?? labels.error)
      : source === "linear"
        ? (linear.error ?? scopes.error ?? metadata.error)
        : null;

  const currentBinding = (): SymphonyBinding | undefined => {
    if (source === "github")
      return { source, repo, prepareLabels, reviewLabels };
    if (source === "linear")
      return {
        source,
        connectionId: linearConnectionId,
        workspaceId: bindingWorkspaceId,
        teamId,
        ...(projectId ? { projectId } : {}),
        prepareStateIds,
        reviewStateIds,
      };
    return undefined;
  };

  const testConnection = async () => {
    const url = symphonyBaseUrlSchema.safeParse(baseUrl);
    if (!url.success) {
      setTestError(url.error.issues[0].message);
      setTestedUrl(null);
      return;
    }
    setTesting(true);
    setTestedUrl(null);
    setTestError(null);
    try {
      await host.call("arco_symphony_test_connection", { baseUrl: url.data });
      setTestedUrl(baseUrl);
    } catch (failure) {
      setTestError(
        failure instanceof Error ? failure.message : "Could not test Symphony.",
      );
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setError(null);
    const binding = currentBinding();
    const parsed = symphonyConnectionSchema.safeParse({
      id,
      name,
      baseUrl,
      ...(binding ? { binding } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    const bindingChanged =
      JSON.stringify(binding) !== JSON.stringify(connection?.binding);
    if (bindingChanged && binding?.source === "github") {
      const available = new Set(labels.data?.labels.map((label) => label.name));
      if (
        !github.data?.connected ||
        !githubGeneration ||
        !labels.data ||
        labels.isError ||
        labels.data.repo.toLowerCase() !== binding.repo.toLowerCase() ||
        [...binding.prepareLabels, ...binding.reviewLabels].some(
          (label) => !available.has(label),
        )
      ) {
        setError("Choose a connected repository and its existing labels.");
        return;
      }
    }
    if (bindingChanged && binding?.source === "linear") {
      const states = new Set(metadata.data?.states.map((state) => state.id));
      if (
        !linear.data?.connected ||
        !teamExists ||
        !metadata.data ||
        metadata.isError ||
        workspaceId !== linear.data.workspace?.id ||
        [...binding.prepareStateIds, ...binding.reviewStateIds].some(
          (state) => !states.has(state),
        ) ||
        (projectId &&
          !metadata.data.projects.some((project) => project.id === projectId))
      ) {
        setError("Choose a connected Linear team and its existing values.");
        return;
      }
    }
    setSaving(true);
    try {
      if (bindingChanged && binding?.source === "github") {
        const latest = await host.call<Connection>("arco_connection", {});
        queryClient.setQueryData(["connection"], latest);
        if (latest.authGeneration !== githubGeneration)
          throw new Error("GitHub authentication changed. Reload its options.");
      }
      if (bindingChanged && binding?.source === "linear") {
        const latest = await host.call<LinearConnection>("linear_connection", {
          connectionId: linearConnectionId,
        });
        queryClient.setQueryData(
          ["linear-connection", linearConnectionId],
          latest,
        );
        if (
          !latest.connected ||
          latest.workspace?.id !== workspaceId ||
          latest.userId !== linear.data?.userId ||
          latest.authGeneration !== linear.data?.authGeneration
        )
          throw new Error("Linear authentication changed. Reload its options.");
      }
      await onSave(parsed.data);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save this connection. Your input is preserved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onRemove || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onRemove();
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not remove this connection.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <CreateDialog
      open
      busy={saving}
      title={
        connection ? "Edit Symphony connection" : "Add Symphony connection"
      }
      titleId={titleId}
      closeLabel="Close Symphony connection"
      onClose={onClose}
      scope="Connect an existing Symphony instance. Settings stay on this device."
    >
      <form
        className="symphony-connection-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Connection name
          <input
            aria-label="Connection name"
            autoComplete="off"
            maxLength={100}
            required
            disabled={saving}
            placeholder="Arco development"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Symphony URL
          <input
            aria-label="Symphony URL"
            autoComplete="off"
            type="url"
            required
            maxLength={2048}
            disabled={saving || testing}
            placeholder="http://127.0.0.1:4000"
            value={baseUrl}
            onChange={(event) => {
              setBaseUrl(event.target.value);
              setTestError(null);
            }}
          />
        </label>
        <div className="symphony-connection-test">
          <Button
            type="button"
            color="secondary"
            variant="soft"
            size="sm"
            disabled={saving || testing || !baseUrl.trim()}
            onClick={() => void testConnection()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {testedUrl === baseUrl && (
            <span className="muted" role="status">
              Connection verified
            </span>
          )}
          {testError && (
            <span role="alert" className="inline-error">
              {testError}
            </span>
          )}
        </div>
        <label className="symphony-connection-binding">
          Issue context
          <SingleSelect
            label="Issue context"
            value={source}
            disabled={saving}
            options={[
              { value: "none", label: "Runtime only" },
              { value: "github", label: "GitHub" },
              { value: "linear", label: "Linear" },
            ]}
            onChange={(value) => {
              if (value === "none" || value === "github" || value === "linear")
                setSource(value);
              setError(null);
            }}
          />
        </label>
        <p className="muted">
          Link an existing issue scope to show issue context and group
          preparation and review work. This does not change issues or Symphony
          dispatch rules.
        </p>
        {source === "github" && (
          <div className="symphony-connection-fields">
            {github.data && !github.data.connected && (
              <p className="muted">
                Connect GitHub in Arco to select a repository.
              </p>
            )}
            <label>
              Repository
              <SingleSelect
                label="GitHub repository"
                value={repo}
                loading={repositories.isPending && repositories.isFetching}
                disabled={saving || !github.data?.connected}
                placeholder="Choose a repository"
                options={[
                  ...(repo &&
                  !repositories.data?.pages.some((page) =>
                    page.repositories.some((item) => item.repo === repo),
                  )
                    ? [{ value: repo, label: repo, disabled: true }]
                    : []),
                  ...(repositories.data?.pages.flatMap((page) =>
                    page.repositories
                      .filter((item) => item.issuesEnabled)
                      .map((item) => ({ value: item.repo, label: item.repo })),
                  ) ?? []),
                ]}
                onChange={(value) => {
                  setRepo(value);
                  setPrepareLabels([]);
                  setReviewLabels([]);
                }}
              />
            </label>
            {repositories.hasNextPage && (
              <button
                type="button"
                className="text-button"
                disabled={repositories.isFetchingNextPage}
                onClick={() => void repositories.fetchNextPage()}
              >
                Load more repositories
              </button>
            )}
            <label>
              Preparation labels
              <MultiSelect
                label="Preparation labels"
                value={prepareLabels}
                options={labelOptions}
                disabled={saving || !labels.data || labels.isError}
                loading={labels.isFetching}
                onChange={setPrepareLabels}
              />
            </label>
            <label>
              Review labels
              <MultiSelect
                label="Review labels"
                value={reviewLabels}
                options={labelOptions}
                disabled={saving || !labels.data || labels.isError}
                loading={labels.isFetching}
                onChange={setReviewLabels}
              />
            </label>
          </div>
        )}
        {source === "linear" && (
          <div className="symphony-connection-fields">
            <p className="muted">
              {linear.data?.connected
                ? `${linear.data.workspace?.name ?? "Linear"}${linear.data.account ? ` · ${linear.data.account}` : ""}`
                : "Connect Linear in Arco to select a team."}
            </p>
            <label>
              Team
              <SingleSelect
                label="Linear team"
                value={teamId}
                loading={scopes.isPending && scopes.isFetching}
                disabled={saving || !linear.data?.connected}
                placeholder="Choose a team"
                options={
                  scopes.data?.teams.map((team) => ({
                    value: team.id,
                    label: `${team.name} (${team.key})`,
                  })) ?? []
                }
                onChange={(value) => {
                  setTeamId(value);
                  setBindingWorkspaceId(workspaceId ?? "");
                  setProjectId("");
                  setPrepareStateIds([]);
                  setReviewStateIds([]);
                }}
              />
            </label>
            <label>
              Project
              <SingleSelect
                label="Linear project"
                value={projectId}
                disabled={saving || !metadata.data || metadata.isError}
                loading={metadata.isFetching}
                options={[
                  { value: "", label: "All team projects" },
                  ...(metadata.data?.projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })) ?? []),
                ]}
                onChange={setProjectId}
              />
            </label>
            <label>
              Preparation states
              <MultiSelect
                label="Preparation states"
                value={prepareStateIds}
                options={stateOptions}
                disabled={saving || !metadata.data || metadata.isError}
                loading={metadata.isFetching}
                onChange={setPrepareStateIds}
              />
            </label>
            <label>
              Review states
              <MultiSelect
                label="Review states"
                value={reviewStateIds}
                options={stateOptions}
                disabled={saving || !metadata.data || metadata.isError}
                loading={metadata.isFetching}
                onChange={setReviewStateIds}
              />
            </label>
          </div>
        )}
        {(catalogError || (source !== "none" && error)) && (
          <>
            {catalogError && (
              <p className="inline-error" role="alert">
                {catalogError.message}
              </p>
            )}
            <button
              type="button"
              className="text-button"
              disabled={saving}
              onClick={() => {
                if (source === "github") {
                  void github.refetch();
                  void repositories.refetch();
                  if (repo) void labels.refetch();
                } else if (source === "linear") {
                  void linear.refetch();
                  void scopes.refetch();
                  if (teamExists) void metadata.refetch();
                }
              }}
            >
              Reload issue options
            </button>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {confirmRemove && (
          <div
            className="symphony-connection-remove"
            role="group"
            aria-label="Remove this connection?"
          >
            <p>
              Remove this connection? Its Symphony instance and issues stay
              unchanged.
            </p>
            <Button
              type="button"
              color="secondary"
              size="sm"
              disabled={saving}
              onClick={() => setConfirmRemove(false)}
            >
              Keep connection
            </Button>
            <Button
              type="button"
              color="danger"
              size="sm"
              disabled={saving}
              onClick={() => void remove()}
            >
              Remove connection
            </Button>
          </div>
        )}
        <div className="dialog-actions">
          {onRemove && !confirmRemove && (
            <Button
              type="button"
              color="secondary"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => setConfirmRemove(true)}
            >
              Remove connection
            </Button>
          )}
          <Button
            type="button"
            color="secondary"
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            color="primary"
            size="sm"
            disabled={saving || !name.trim() || !baseUrl.trim()}
          >
            {saving ? "Saving…" : "Save connection"}
          </Button>
        </div>
      </form>
    </CreateDialog>
  );
}
