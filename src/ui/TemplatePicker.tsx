import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import type { ArcoHost } from "../shared/contracts";
import type { IssueTemplates } from "../shared/github-operations";
import { SingleSelect } from "./SingleSelect";

export interface TemplateDraft {
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  issueTypeName: string;
}
export function TemplatePicker({
  host,
  repo,
  disabled,
  onApply,
}: {
  host: ArcoHost;
  repo: string;
  disabled: boolean;
  onApply: (draft: TemplateDraft) => void;
}) {
  const query = useQuery({
    queryKey: ["github", "templates", repo],
    queryFn: () => host.call<IssueTemplates>("arco_issue_templates", { repo }),
  });
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const template = query.data?.templates.find(
    (template) => template.path === path,
  );
  const open = async (url: string) => {
    try {
      await host.openLink(url);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section className="template-picker">
      <label>
        Existing template
        <SingleSelect
          label="Issue template"
          value={path}
          disabled={disabled || query.isPending}
          onChange={setPath}
          options={[
            { value: "", label: "No template" },
            ...(query.data?.templates.map((template) => ({
              value: template.path,
              label: `${template.name}${template.kind === "unsupported" ? " · Create on GitHub" : ""}`,
            })) ?? []),
          ]}
        />
      </label>
      {query.isError && (
        <p className="inline-error" role="alert">
          {query.error.message}
        </p>
      )}
      {template && (
        <>
          <p className="property-note">{template.description}</p>
          {template.kind === "simple" ? (
            <>
              <p className="property-note">
                Applying replaces the title, body, labels, assignees, and issue
                type with the template defaults.
              </p>
              <Button
                color="secondary"
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onApply({
                    title: template.defaults?.title ?? "",
                    body: template.body ?? "",
                    labels: template.defaults?.labels ?? [],
                    assignees: template.defaults?.assignees ?? [],
                    issueTypeName: template.defaults?.type ?? "",
                  })
                }
              >
                Apply template
              </Button>
            </>
          ) : (
            <>
              <p className="inline-error">
                {template.reason ||
                  "This template has required or unsupported fields. Complete it on GitHub."}
              </p>
              <button
                className="text-button"
                type="button"
                onClick={() => void open(template.url)}
              >
                Open this template on GitHub ↗
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
