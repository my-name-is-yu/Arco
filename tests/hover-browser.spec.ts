import {
  expect,
  test,
  type FrameLocator,
  type Locator,
  type Page,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { choose, selectControl } from "./select-helpers";

const githubTitle = "Preserve issue selection and scroll position";
const linearTitle = "Keep Linear workflow states intact";
const app = (page: Page) => page.frameLocator("#arco");
const hoverScale = 1.04;

async function appearance(control: Locator) {
  return control.evaluate(async (element) => {
    await Promise.allSettled(
      element
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished),
    );
    const style = getComputedStyle(element);
    const input = element instanceof HTMLInputElement ? element : null;
    const fileButton =
      input?.type === "file"
        ? getComputedStyle(element, "::file-selector-button")
        : null;
    const before = getComputedStyle(element, "::before");
    const after = getComputedStyle(element, "::after");
    const pseudoPaint = (pseudo: CSSStyleDeclaration) =>
      !["none", "normal"].includes(pseudo.content)
        ? {
            background: pseudo.backgroundColor,
            border: pseudo.borderColor,
            shadow: pseudo.boxShadow,
            opacity: pseudo.opacity,
            filter: pseudo.filter,
          }
        : undefined;
    return {
      paint: {
        background: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        border: style.borderColor,
        color: style.color,
        shadow: style.boxShadow,
        outline: style.outline,
        decoration: style.textDecoration,
        filter: style.filter,
        opacity: style.opacity,
        before: pseudoPaint(before),
        after: pseudoPaint(after),
        fileButton: fileButton
          ? {
              background: fileButton.backgroundColor,
              border: fileButton.borderColor,
              color: fileButton.color,
              shadow: fileButton.boxShadow,
            }
          : undefined,
      },
      duration: Math.max(
        ...[style, before, after, ...(fileButton ? [fileButton] : [])]
          .flatMap((paintStyle) => paintStyle.transitionDuration.split(","))
          .map(
            (duration) =>
              Number.parseFloat(duration) *
              (duration.trim().endsWith("ms") ? 1 : 1000),
          ),
      ),
      state: {
        pressed: element.getAttribute("aria-pressed"),
        expanded: element.getAttribute("aria-expanded"),
        selected: element.getAttribute("aria-selected"),
        selectedClass: element.classList.contains("selected"),
        checked: input?.checked,
        value:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
            ? element.value
            : undefined,
        disabled: element.getAttribute("disabled"),
      },
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      layoutWidth: element instanceof HTMLElement ? element.offsetWidth : null,
      layoutHeight:
        element instanceof HTMLElement ? element.offsetHeight : null,
    };
  });
}

type HoverSample = {
  label: string;
  before: Awaited<ReturnType<typeof appearance>>;
  after: Awaited<ReturnType<typeof appearance>>;
  hoveredScale: number;
};
const samples = new WeakMap<Page, HoverSample[]>();
const errors = new WeakMap<Page, string[]>();

type HoverOptions = {
  reducedMotion?: boolean;
  disabled?: boolean;
  hoverTarget?: Locator;
  scale?: number;
  scaleTarget?: Locator;
  whileHovered?: () => Promise<void>;
  duration?: number;
};

async function hoverFeedback(
  page: Page,
  label: string,
  control: Locator,
  options: HoverOptions = {},
) {
  await test.step(label, async () => {
    await control.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    const before = await appearance(control);
    const scaleTarget = options.scaleTarget ?? control;
    const scaleBefore = options.scaleTarget
      ? await appearance(scaleTarget)
      : before;
    await (options.hoverTarget ?? control).hover({ force: options.disabled });
    await expect
      .poll(async () => (await appearance(control)).paint)
      .toEqual(
        options.disabled
          ? before.paint
          : expect.not.objectContaining(before.paint),
      );
    const after = await appearance(control);
    expect(after.state).toEqual(before.state);
    if (before.state.pressed === "true" || before.state.selectedClass) {
      expect(after.paint.background).toBe(before.paint.background);
      expect(after.paint.color).toBe(before.paint.color);
    }
    // Hover may enlarge an action visually, but must never reflow its layout.
    expect(after.layoutWidth).toBe(before.layoutWidth);
    expect(after.layoutHeight).toBe(before.layoutHeight);
    const scaleAfter = options.scaleTarget
      ? await appearance(scaleTarget)
      : after;
    const expectedScale =
      options.disabled || options.reducedMotion ? 1 : (options.scale ?? 1);
    expect(scaleAfter.layoutWidth).toBe(scaleBefore.layoutWidth);
    expect(scaleAfter.layoutHeight).toBe(scaleBefore.layoutHeight);
    expect(scaleAfter.width).toBeCloseTo(scaleBefore.width * expectedScale, 1);
    expect(scaleAfter.height).toBeCloseTo(
      scaleBefore.height * expectedScale,
      1,
    );
    if (options.scaleTarget) {
      expect(after.width).toBeCloseTo(before.width, 1);
      expect(after.height).toBeCloseTo(before.height, 1);
    }
    if (!options.disabled) {
      if (options.reducedMotion) expect(after.duration).toBe(0);
      else expect(after.duration).toBeGreaterThan(0);
      if (options.duration !== undefined && !options.reducedMotion)
        expect(after.duration).toBe(options.duration);
    }
    await options.whileHovered?.();
    await page.mouse.move(1, 1);
    const restored = await appearance(scaleTarget);
    expect(restored.width).toBeCloseTo(scaleBefore.width, 1);
    expect(restored.height).toBeCloseTo(scaleBefore.height, 1);
    samples.get(page)!.push({
      label,
      before,
      after,
      hoveredScale: scaleAfter.width / scaleBefore.width,
    });
  });
}

async function openGithub(page: Page) {
  await page.goto("/");
  await expect(page.locator("#bridge-status")).toHaveText("ready");
  await choose(app(page), "GitHub view", "yu/Arco");
  await expect(
    app(page).getByRole("heading", { name: githubTitle, exact: true }),
  ).toBeVisible();
}

async function issueActions(page: Page) {
  await app(page).getByLabel("Issue actions", { exact: true }).click();
}

async function annotationComment(page: Page) {
  const ui = app(page);
  const source = ui.locator(".issue-body p").first();
  await source.scrollIntoViewIfNeeded();
  await source.evaluate(async (element) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await ui
    .getByRole("toolbar", { name: "Text selection", exact: true })
    .getByRole("button", { name: "Add to chat", exact: true })
    .click();
  const comment = ui.getByRole("dialog", {
    name: "Selection comment",
    exact: true,
  });
  await expect(comment).toBeVisible();
  return comment;
}

async function auditVisibleActions(
  page: Page,
  scope: FrameLocator | Locator,
  stage: string,
) {
  const controls = scope.locator("button, summary");
  let audited = 0;
  for (let index = 0; index < (await controls.count()); index++) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const description = await control.evaluate((element) => ({
      hidden: Boolean(element.closest('[inert], [aria-hidden="true"]')),
      disabled: element.matches(
        ':disabled, [aria-disabled="true"], [data-disabled], [data-loading]',
      ),
      // These are the selection and reading surfaces excluded by the agreed scope.
      selection:
        Boolean(
          element.closest(
            '.segmented, .editor-tabs, [data-motion="selection"], .source-single-select, .source-multi-select',
          ),
        ) || element.matches(".issue-row, .markdown-link"),
      name:
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent?.trim().replace(/\s+/g, " "),
      summary: element.tagName === "SUMMARY",
    }));
    if (description.hidden) continue;
    const label = control.locator(":scope > .disclosure-label");
    await hoverFeedback(
      page,
      `${stage}: ${description.name || `control ${index}`}`,
      control,
      {
        disabled: description.disabled,
        scale: description.selection ? 1 : hoverScale,
        scaleTarget:
          description.summary && (await label.count()) ? label : undefined,
        duration: description.selection ? undefined : 150,
      },
    );
    audited++;
  }
  expect(audited).toBeGreaterThan(2);
}

test.beforeEach(async ({ page }) => {
  samples.set(page, []);
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      document.documentElement.dataset.hoverCspViolations = JSON.stringify([
        ...JSON.parse(
          document.documentElement.dataset.hoverCspViolations ?? "[]",
        ),
        event.effectiveDirective,
      ]);
    });
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as {
      name: string;
      arguments: { page: number };
    };
    if (!["arco_get_issue", "arco_list_issues"].includes(input.name))
      return route.continue();
    const response = await route.fetch();
    const result = await response.json();
    if (input.name === "arco_get_issue")
      result.structuredContent.body +=
        "\n\n[Fixture documentation](https://example.com/arco-hover)";
    else {
      result.structuredContent.hasMore = input.arguments.page < 10;
      result.structuredContent.nextCursor = `fixture:${input.arguments.page}`;
    }
    await route.fulfill({ response, json: result });
  });
});

test.afterEach(async ({ page }, info) => {
  const samplePath = info.outputPath("hover-feedback-samples.json");
  await writeFile(samplePath, JSON.stringify(samples.get(page), null, 2));
  await info.attach("hover-feedback-samples", {
    path: samplePath,
  });
  const violations = await Promise.all(
    page
      .frames()
      .map((frame) =>
        frame.evaluate(() =>
          JSON.parse(
            document.documentElement.dataset.hoverCspViolations ?? "[]",
          ),
        ),
      ),
  );
  expect(violations.flat()).toEqual([]);
  expect(errors.get(page)).toEqual([]);
  await expect(page.locator("#harness-error")).toBeEmpty();
});

test("GitHub navigation, disclosures, content actions, and native fields have hover feedback without changing state", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openGithub(page);
  const ui = app(page);
  const controls: [string, Locator, HoverOptions?][] = [
    [
      "selected state segment",
      ui
        .locator(".segmented")
        .getByRole("button", { name: "Open", exact: true }),
    ],
    [
      "unselected state segment",
      ui
        .locator(".segmented")
        .getByRole("button", { name: "Closed", exact: true }),
    ],
    ["selected issue row", ui.locator(".issue-row.selected")],
    [
      "unselected issue row",
      ui.locator(".issue-row").filter({ hasText: "Separate shared context" }),
    ],
    [
      "filters disclosure",
      ui.locator(".sidebar-filters > summary"),
      {
        scale: hoverScale,
        scaleTarget: ui.locator(
          ".sidebar-filters > summary > .disclosure-label",
        ),
      },
    ],
    [
      "advanced properties disclosure",
      ui.locator(".property-advanced > summary"),
      {
        scale: hoverScale,
        scaleTarget: ui.locator(
          ".property-advanced > summary > .disclosure-label",
        ),
      },
    ],
    ["search field shell", ui.locator(".search-control")],
    [
      "bulk checkbox",
      ui.getByRole("checkbox", {
        name: "Select yu/Arco #42 for bulk actions",
        exact: true,
      }),
    ],
    [
      "checked Markdown task",
      ui.getByRole("checkbox", {
        name: "Completion of Show the issue list and details side by side",
        exact: true,
      }),
    ],
    [
      "unchecked Markdown task",
      ui.getByRole("checkbox", {
        name: "Completion of Preserve filters, selection, and scroll position",
        exact: true,
      }),
    ],
    [
      "pagination button",
      ui.getByRole("button", { name: "Load more", exact: true }),
      { scale: hoverScale },
    ],
    [
      "Markdown link",
      ui.getByRole("button", { name: "Fixture documentation", exact: true }),
    ],
    [
      "SDK primary button",
      ui.getByRole("button", { name: "Add to chat", exact: true }).first(),
      { scale: hoverScale },
    ],
    [
      "SDK Select trigger",
      selectControl(ui, "Issue source").getByRole("button"),
    ],
  ];
  for (const [label, control, options] of controls)
    await hoverFeedback(page, label, control, options);
  await ui
    .getByRole("button", { name: "Choose reaction", exact: true })
    .first()
    .click();
  await hoverFeedback(
    page,
    "GitHub reaction choice",
    ui
      .getByRole("button", { name: "heart 0 Add reaction", exact: true })
      .first(),
    { scale: hoverScale },
  );
  await expect(
    ui.locator(".segmented").getByRole("button", { name: "Open", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await auditVisibleActions(page, ui, "GitHub workspace action inventory");
  await hoverFeedback(
    page,
    "utility menu trigger",
    ui.getByLabel("Issue actions", { exact: true }),
    { scale: hoverScale, duration: 150 },
  );
  await issueActions(page);
  await auditVisibleActions(
    page,
    ui.locator(".detail-utility-menu"),
    "utility action inventory",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mock inline", exact: true }).click();
  await expect(ui.locator(".inline-mode")).toBeVisible();
  await hoverFeedback(
    page,
    "inline Open details action",
    ui.getByRole("button", { name: "Open details", exact: true }),
    { scale: hoverScale, duration: 150 },
  );
  const description = ui.getByRole("region", {
    name: "Issue description text",
    exact: true,
  });
  await expect(
    ui.getByRole("button", { name: /(?:Expand|Collapse) description/ }),
  ).toHaveCount(0);
  await description.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  const before = await appearance(description);
  await description.hover();
  const after = await appearance(description);
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.height).toBeCloseTo(before.height, 1);
  expect(after.paint).toEqual(before.paint);
  expect(after.state).toEqual(before.state);
});

test("editor tabs and fields respond to hover while disabled custom and SDK buttons remain unchanged", async ({
  page,
}) => {
  await openGithub(page);
  const ui = app(page);
  const refresh = ui.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toBeEnabled();
  await hoverFeedback(page, "enabled refresh icon", refresh, {
    scale: hoverScale,
  });
  let release!: () => void;
  const pendingList = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_list_issues") await pendingList;
    await route.continue();
  });
  try {
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await hoverFeedback(page, "disabled refresh icon", refresh, {
      disabled: true,
    });
  } finally {
    release();
  }
  await expect(refresh).toBeEnabled();
  await issueActions(page);
  await ui.getByRole("button", { name: "Edit issue", exact: true }).click();
  await ui.getByRole("heading", { name: githubTitle, exact: true }).click();
  const editor = ui.getByRole("region", {
    name: "Edit issue body",
    exact: true,
  });
  for (const [label, control] of [
    [
      "active editor tab",
      editor.getByRole("button", { name: "Edit", exact: true }),
    ],
    [
      "inactive preview tab",
      editor.getByRole("button", { name: "Preview", exact: true }),
    ],
    [
      "title input",
      ui.getByRole("textbox", { name: "Issue title", exact: true }),
    ],
    [
      "body textarea",
      ui.getByRole("textbox", { name: "Issue body", exact: true }),
    ],
  ] as [string, Locator][])
    await hoverFeedback(page, label, control);
  const save = ui
    .getByRole("region", { name: "Edit issue body", exact: true })
    .getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  await hoverFeedback(page, "disabled SDK Save button", save, {
    disabled: true,
    scale: hoverScale,
  });
  await hoverFeedback(
    page,
    "SDK close editor action",
    editor.getByRole("button", { name: "Close", exact: true }),
    { scale: hoverScale },
  );
  await expect(
    editor.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await ui.getByRole("button", { name: "Create issue", exact: true }).click();
  const modal = ui.getByRole("dialog", { name: "Create issue", exact: true });
  await choose(modal, "Issue template", ".github/ISSUE_TEMPLATE/bug.md");
  await modal
    .getByRole("button", { name: "Apply template", exact: true })
    .click();
  await hoverFeedback(
    page,
    "removable template label chip",
    modal.getByTitle("Remove initial label", { exact: true }),
    { scale: hoverScale, duration: 150 },
  );
  await auditVisibleActions(page, modal, "creation modal action inventory");
  await modal.getByRole("button", { name: "Close", exact: true }).click();
});

test("Linear shares hover feedback across disclosures, row selection, reactions, and editing controls", async ({
  page,
}) => {
  await openGithub(page);
  const ui = app(page);
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
  for (const [label, control, options] of [
    [
      "Linear filters disclosure",
      ui.locator(".linear-filters > summary"),
      {
        scale: hoverScale,
        scaleTarget: ui.locator(
          ".linear-filters > summary > .disclosure-label",
        ),
      },
    ],
    [
      "Linear advanced properties",
      ui.locator(".property-advanced > summary"),
      {
        scale: hoverScale,
        scaleTarget: ui.locator(
          ".property-advanced > summary > .disclosure-label",
        ),
      },
    ],
    ["Linear selected row", ui.locator(".issue-row.selected")],
    [
      "Linear unselected row",
      ui.locator(".issue-row").filter({ hasText: "Share a Linear issue" }),
    ],
    [
      "Linear comment textarea",
      ui.getByRole("textbox", { name: "Linear comment", exact: true }),
    ],
    ["Linear SDK Select", selectControl(ui, "Linear Team").getByRole("button")],
    [
      "Linear reaction disclosure",
      ui.getByLabel("Choose Issue reaction", { exact: true }),
      { scale: hoverScale },
    ],
  ] as [string, Locator, HoverOptions?][])
    await hoverFeedback(page, label, control, options);
  await ui.getByLabel("Choose Issue reaction", { exact: true }).click();
  await hoverFeedback(
    page,
    "Linear reaction choice",
    ui.getByRole("button", { name: "Add ❤️ Issue reaction", exact: true }),
    { scale: hoverScale },
  );
  await page.keyboard.press("Escape");
  await ui.getByText("Add file or URL", { exact: true }).click();
  await hoverFeedback(
    page,
    "native file picker",
    ui.getByLabel("Upload file to Linear", { exact: true }),
  );
  await ui.locator(".property-advanced > summary").click();
  await hoverFeedback(
    page,
    "native due-date picker",
    ui.getByLabel("Linear Due date", { exact: true }),
  );
  await ui.getByText("Manage label definitions", { exact: true }).click();
  await hoverFeedback(
    page,
    "native label-color picker",
    ui.getByLabel("Color", { exact: true }),
  );
  await issueActions(page);
  await ui
    .getByRole("button", { name: "Edit Linear description", exact: true })
    .click();
  await ui.getByRole("heading", { name: linearTitle, exact: true }).click();
  await hoverFeedback(
    page,
    "Linear Markdown editor",
    ui.getByRole("textbox", {
      name: "Linear Markdown description",
      exact: true,
    }),
  );
  await hoverFeedback(
    page,
    "Linear preview control",
    ui
      .getByRole("region", { name: "Edit Linear description", exact: true })
      .getByRole("button", { name: "Preview", exact: true }),
  );
});

test("annotation numbers provide hover feedback while preserving their text and location", async ({
  page,
}) => {
  await openGithub(page);
  const ui = app(page);
  const comment = await annotationComment(page);
  await hoverFeedback(
    page,
    "annotation Trash action",
    comment.getByRole("button", { name: "Remove annotation 1", exact: true }),
    { scale: hoverScale, duration: 150 },
  );
  await hoverFeedback(
    page,
    "annotation Save action",
    comment.getByRole("button", { name: "Save comment", exact: true }),
    { scale: hoverScale, duration: 150 },
  );
  await hoverFeedback(page, "annotation comment field shell", comment, {
    hoverTarget: comment.getByRole("textbox", {
      name: "Optional comment",
      exact: true,
    }),
  });
  let release!: () => void;
  const snapshotPending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/tool", async (route) => {
    const input = route.request().postDataJSON() as { name: string };
    if (input.name === "arco_write_annotation_snapshot") await snapshotPending;
    await route.continue();
  });
  await comment
    .getByRole("textbox", { name: "Optional comment", exact: true })
    .fill("A saved fixture annotation comment");
  await comment
    .getByRole("button", { name: "Save comment", exact: true })
    .click();
  try {
    for (const name of ["Remove annotation 1", "Save comment"]) {
      const action = comment.getByRole("button", { name, exact: true });
      await expect(action).toBeDisabled();
      await hoverFeedback(page, `disabled annotation ${name}`, action, {
        scale: hoverScale,
        disabled: true,
      });
    }
  } finally {
    release();
  }
  await expect(comment).toHaveCount(0);
  await ui
    .getByRole("button", { name: "Edit selection comment 1", exact: true })
    .click();
  await expect(comment).toBeVisible();
  await page.keyboard.press("Escape");
  const marker = ui.getByRole("button", {
    name: "Edit selection comment 1",
    exact: true,
  });
  await expect(marker).toHaveText("1");
  const annotatedRanges = () =>
    ui.locator("body").evaluate(() => {
      const registry = (
        CSS as typeof CSS & {
          highlights: { get(name: string): Iterable<Range> | undefined };
        }
      ).highlights;
      return Array.from(registry.get("arco-selection") ?? []).map((range) => {
        if (!(range instanceof Range))
          throw new Error("Expected a live annotation Range.");
        return {
          text: range.toString(),
          rect: range.getBoundingClientRect().toJSON(),
        };
      });
    });
  const sourceBefore = await annotatedRanges();
  expect(sourceBefore).toHaveLength(1);
  await page.mouse.move(1, 1);
  await appearance(marker);
  const before = await marker.boundingBox();
  await hoverFeedback(page, "selection annotation number", marker, {
    scale: hoverScale,
    whileHovered: async () => {
      expect(await annotatedRanges()).toEqual(sourceBefore);
      const hovered = await marker.boundingBox();
      expect(hovered!.x).toBeCloseTo(before!.x, 1);
      expect(hovered!.y + hovered!.height).toBeCloseTo(
        before!.y + before!.height,
        1,
      );
    },
  });
  expect(await marker.boundingBox()).toEqual(before);
  expect(await annotatedRanges()).toEqual(sourceBefore);
  await expect(marker).toHaveText("1");
});

test("light-theme reduced motion retains immediate hover feedback and the keyboard focus ring", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openGithub(page);
  await page.evaluate(() => {
    document
      .querySelector<HTMLIFrameElement>("#arco")!
      .contentWindow!.postMessage(
        {
          jsonrpc: "2.0",
          method: "ui/notifications/host-context-changed",
          params: { theme: "light" },
        },
        "*",
      );
  });
  const ui = app(page);
  await expect
    .poll(() =>
      ui
        .locator(".workspace")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe("rgb(255, 255, 255)");
  for (const [label, control, options] of [
    [
      "light reduced-motion segment",
      ui
        .locator(".segmented")
        .getByRole("button", { name: "Closed", exact: true }),
    ],
    [
      "light reduced-motion disclosure",
      ui.locator(".sidebar-filters > summary"),
      {
        scale: hoverScale,
        scaleTarget: ui.locator(
          ".sidebar-filters > summary > .disclosure-label",
        ),
      },
    ],
    [
      "light reduced-motion checkbox",
      ui.getByRole("checkbox", {
        name: "Select yu/Arco #42 for bulk actions",
        exact: true,
      }),
    ],
    ["light reduced-motion search shell", ui.locator(".search-control")],
    [
      "reduced-motion primary action",
      ui.getByRole("button", { name: "Add to chat", exact: true }).first(),
      { scale: hoverScale },
    ],
    [
      "reduced-motion icon action",
      ui.getByRole("button", { name: "Refresh", exact: true }),
      { scale: hoverScale },
    ],
  ] as [string, Locator, HoverOptions?][])
    await hoverFeedback(page, label, control, {
      ...options,
      reducedMotion: true,
    });
  const search = ui.getByRole("textbox", {
    name: "Search issues",
    exact: true,
  });
  await search.focus();
  const searchShell = ui.locator(".search-control");
  const focused = await searchShell.evaluate(
    (element) => getComputedStyle(element).outline,
  );
  expect(focused).not.toContain("none");
  expect(
    await search.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("none");
  await search.hover();
  expect(
    await searchShell.evaluate((element) => getComputedStyle(element).outline),
  ).toBe(focused);
  const comment = await annotationComment(page);
  for (const name of ["Remove annotation 1", "Save comment"])
    await hoverFeedback(
      page,
      `reduced-motion annotation ${name}`,
      comment.getByRole("button", { name, exact: true }),
      { scale: hoverScale, reducedMotion: true },
    );
  await page.keyboard.press("Escape");
  await choose(ui, "Issue source", "linear");
  await expect(
    ui.getByRole("heading", { name: linearTitle, exact: true }),
  ).toBeVisible();
  await ui.getByText("Add file or URL", { exact: true }).click();
  await hoverFeedback(
    page,
    "reduced-motion native file picker",
    ui.getByLabel("Upload file to Linear", { exact: true }),
    { reducedMotion: true },
  );
});

test.describe("touch input", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("tapping a state filter changes selection without leaving a sticky hover tint", async ({
    page,
  }) => {
    await openGithub(page);
    const comment = await annotationComment(page);
    for (const name of ["Remove annotation 1", "Save comment"]) {
      const action = comment.getByRole("button", { name, exact: true });
      await page.mouse.move(1, 1);
      const before = await appearance(action);
      await action.hover();
      const hovered = await appearance(action);
      expect(hovered.paint).toEqual(before.paint);
      expect(hovered.width).toBeCloseTo(before.width, 1);
      expect(hovered.height).toBeCloseTo(before.height, 1);
      samples.get(page)!.push({
        label: `touch annotation ${name}`,
        before,
        after: hovered,
        hoveredScale: hovered.width / before.width,
      });
    }
    await comment
      .getByRole("button", { name: "Save comment", exact: true })
      .tap();
    await expect(comment).toHaveCount(0);
    const annotation = app(page).getByRole("button", {
      name: "Edit selection comment 1",
      exact: true,
    });
    await annotation.tap();
    await comment
      .getByRole("button", { name: "Remove annotation 1", exact: true })
      .tap();
    await expect(annotation).toHaveCount(0);
    expect(
      await page.evaluate(
        () => matchMedia("(hover: hover) and (pointer: fine)").matches,
      ),
    ).toBe(false);
    const closed = app(page)
      .locator(".segmented")
      .getByRole("button", { name: "Closed", exact: true });
    const before = await appearance(closed);
    await closed.tap();
    await expect(closed).toHaveAttribute("aria-pressed", "true");
    expect((await appearance(closed)).paint.shadow).toBe(before.paint.shadow);
    const selectedBefore = await appearance(closed);
    await closed.hover();
    const selectedHovered = await appearance(closed);
    expect(selectedHovered.paint.shadow).toBe(before.paint.shadow);
    samples.get(page)!.push({
      label: "touch selected filter",
      before: selectedBefore,
      after: selectedHovered,
      hoveredScale: selectedHovered.width / selectedBefore.width,
    });
    await expect(closed).toHaveAttribute("aria-pressed", "true");
    const refresh = app(page).getByRole("button", {
      name: "Refresh",
      exact: true,
    });
    await expect(refresh).toBeEnabled();
    await page.mouse.move(1, 1);
    const iconBefore = await appearance(refresh);
    await refresh.hover();
    const iconHovered = await appearance(refresh);
    expect(iconHovered.paint).toEqual(iconBefore.paint);
    expect(iconHovered.width).toBeCloseTo(iconBefore.width, 1);
    expect(iconHovered.height).toBeCloseTo(iconBefore.height, 1);
    samples.get(page)!.push({
      label: "touch refresh action",
      before: iconBefore,
      after: iconHovered,
      hoveredScale: iconHovered.width / iconBefore.width,
    });
  });
});
