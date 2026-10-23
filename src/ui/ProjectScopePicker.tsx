import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ArcoHost } from "../shared/contracts";
import type { ProjectChoices } from "../shared/github-operations";
import { SingleSelect } from "./SingleSelect";
import { DisclosureSummary } from "./DisclosureSummary";

export function ProjectScopePicker({
  host,
  repo,
  value,
  onChange,
}: {
  host: ArcoHost;
  repo: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState(repo.split("/")[0]);
  const [owner, setOwner] = useState(ownerDraft);
  const [ownerType, setOwnerType] = useState<"user" | "organization">("user");
  const query = useInfiniteQuery({
    queryKey: ["github", "scope-projects", repo, owner, ownerType],
    queryFn: ({ pageParam }) =>
      host.call<ProjectChoices>("arco_projects", {
        repo,
        owner,
        ownerType,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) =>
      last.hasMore ? (last.cursor ?? undefined) : undefined,
    enabled: open && Boolean(repo),
  });
  return (
    <details
      className="project-scope"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <DisclosureSummary>
        Filter by Project{value ? ` · ${value}` : ""}
      </DisclosureSummary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setOwner(ownerDraft.trim());
        }}
      >
        <label>
          Project owner
          <input
            aria-label="List Project owner"
            required
            pattern="[A-Za-z0-9-]+"
            value={ownerDraft}
            onChange={(event) => setOwnerDraft(event.target.value)}
          />
        </label>
        <label>
          Type
          <SingleSelect
            label="List Project owner type"
            value={ownerType}
            onChange={(value) =>
              setOwnerType(value === "organization" ? "organization" : "user")
            }
            options={[
              { value: "user", label: "User" },
              { value: "organization", label: "Organization" },
            ]}
          />
        </label>
        <button type="submit" className="text-button">
          Load existing Projects
        </button>
      </form>
      <label>
        Project
        <SingleSelect
          label="Project filter"
          value={value}
          disabled={query.isPending}
          onChange={onChange}
          options={[
            { value: "", label: "No Project filter" },
            ...(query.data?.pages
              .flatMap((page) =>
                page.projects.map((project) => ({
                  ...project,
                  owner: page.owner,
                })),
              )
              .map((project) => ({
                value: `${project.owner}/${project.number}`,
                label: `${project.title}${project.closed ? " (Closed)" : ""}`,
              })) ?? []),
          ]}
        />
      </label>
      {query.hasNextPage && (
        <button
          className="text-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more Projects
        </button>
      )}
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      <p>
        Shows issues in both the current repository and the selected Project.
      </p>
    </details>
  );
}
