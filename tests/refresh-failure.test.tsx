import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commandError } from "../src/server/github/transport";
import { RefreshFailure } from "../src/ui/RefreshFailure";

describe("issue refresh failure presentation", () => {
  it.each([
    ["auth", "gh: Bad credentials (HTTP 401)", "Check gh auth login"],
    [
      "forbidden",
      "gh: Resource not accessible by integration (HTTP 403)",
      "Check the target and your GitHub CLI permissions",
    ],
    ["rate-limited", "gh: Too many requests (HTTP 429)", "Wait and refresh"],
  ])(
    "renders %s recovery without uncertain-write instructions",
    (_kind, stderr, guidance) => {
      const error = commandError(stderr);
      const html = renderToStaticMarkup(
        <RefreshFailure error={error} pending={false} onRetry={() => {}} />,
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain("Could not refresh this issue.");
      expect(html).toContain("Showing the last loaded version.");
      expect(html).toContain(error.message);
      expect(html).toContain(guidance);
      expect(html).not.toContain("submitting this change again");
      expect(html).toContain("Retry refresh");
      const button = html.match(/<button\b[^>]*>/)?.[0];
      expect(button).toBeDefined();
      expect(button).toContain('aria-disabled="false"');
      expect(button).not.toMatch(/\sdisabled(?:\s|=|>)/);
    },
  );

  it("disables retry while a refresh is pending", () => {
    const html = renderToStaticMarkup(
      <RefreshFailure
        error={new Error("Refresh is unavailable.")}
        pending={true}
        onRetry={() => {}}
      />,
    );
    expect(html.match(/<button\b[^>]*>/)?.[0]).toContain('disabled=""');
    expect(html).toContain("Retry refresh");
  });

  it("renders nothing without a refresh error", () => {
    expect(
      renderToStaticMarkup(
        <RefreshFailure error={null} pending={false} onRetry={() => {}} />,
      ),
    ).toBe("");
  });
});
