import { z } from "zod";
import { type LabelDefinition } from "../../shared/github-operations";
import {
  invalid,
  type GitHubOperationContext,
  type Input,
} from "./operations-context";
import { parse } from "./transport";
const apiLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  description: z.string().nullable(),
});

function labelDto(label: z.infer<typeof apiLabelSchema>): LabelDefinition {
  return {
    id: String(label.id),
    name: label.name,
    color: label.color,
    description: label.description ?? "",
  };
}
export function createLabelsOperations(context: GitHubOperationContext) {
  const { once, api, pages } = context;
  async function labelDefinitions(input: Input<"arco_label_definitions">) {
    return {
      repo: input.repo,
      labels: (
        await pages(`repos/${input.repo}/labels?per_page=100`, apiLabelSchema)
      ).map(labelDto),
    };
  }

  function createLabel(input: Input<"arco_create_label">) {
    return once(input.requestId, ["createLabel", input], async () => ({
      repo: input.repo,
      label: labelDto(
        parse(
          apiLabelSchema,
          await api("write", `repos/${input.repo}/labels`, "POST", {
            name: input.name,
            color: input.color,
            description: input.description,
          }),
        ),
      ),
    }));
  }

  function updateLabel(input: Input<"arco_update_label">) {
    return once(input.requestId, ["updateLabel", input], async () => {
      if (!Object.keys(input.patch).length)
        return invalid("Select the label definition fields to change.");
      const { name, ...patch } = input.patch;
      return {
        repo: input.repo,
        label: labelDto(
          parse(
            apiLabelSchema,
            await api(
              "write",
              `repos/${input.repo}/labels/${encodeURIComponent(input.name)}`,
              "PATCH",
              { ...patch, ...(name !== undefined ? { new_name: name } : {}) },
            ),
          ),
        ),
      };
    });
  }

  function deleteLabel(input: Input<"arco_delete_label">) {
    return once(input.requestId, ["deleteLabel", input], async () => {
      await api(
        "write",
        `repos/${input.repo}/labels/${encodeURIComponent(input.name)}`,
        "DELETE",
      );
      return { repo: input.repo, deleted: true };
    });
  }
  return { labelDefinitions, createLabel, updateLabel, deleteLabel };
}
