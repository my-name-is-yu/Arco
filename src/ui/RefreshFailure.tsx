import { AsyncState } from "./AsyncState";
import { Button } from "@openai/apps-sdk-ui/components/Button";
export function RefreshFailure({
  error,
  pending,
  onRetry,
}: {
  error: Error | null;
  pending: boolean;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <AsyncState kind="error" className="notice error">
      <span>
        <strong>Could not refresh this issue.</strong> Showing the last loaded
        version. {error.message}
      </span>
      <Button
        color="secondary"
        variant="outline"
        size="sm"
        disabled={pending}
        loading={pending}
        onClick={onRetry}
      >
        Retry refresh
      </Button>
    </AsyncState>
  );
}
