import { expect, type Page } from "@playwright/test";
import type { Draft } from "../src/shared/state";

const acknowledged = new WeakMap<Page, Draft[]>();

export function observeDraftWrites(page: Page) {
  const drafts: Draft[] = [];
  acknowledged.set(page, drafts);
  page.on("response", async (response) => {
    if (!response.url().endsWith("/tool") || !response.ok()) return;
    const input = response.request().postDataJSON() as { name?: string };
    if (input.name !== "arco_write_draft") return;
    const result = (await response.json().catch(() => null)) as {
      isError?: boolean;
      structuredContent?: { draft?: Draft };
    } | null;
    if (!result?.isError && result?.structuredContent?.draft)
      drafts.push(result.structuredContent.draft);
  });
}

export async function expectDraftWrite(page: Page, expected: Partial<Draft>) {
  await expect
    .poll(() =>
      acknowledged
        .get(page)
        ?.some((draft) =>
          Object.entries(expected).every(
            ([key, value]) => draft[key as keyof Draft] === value,
          ),
        ),
    )
    .toBe(true);
  await expect(
    page.frameLocator("#arco").locator(".draft-storage-status"),
  ).toHaveCount(0);
}
