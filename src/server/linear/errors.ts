import { LinearError, LinearErrorType, parseLinearError } from "@linear/sdk";
import { OperationError } from "../../shared/errors";

export class LinearServiceError extends OperationError {
  constructor(message: string, code = "invalid-input") {
    super(message, code);
    this.name = "LinearServiceError";
  }
}

const uncertain = () =>
  new LinearServiceError(
    "Unable to confirm the Linear change. Check Linear and refresh before retrying.",
    "uncertain",
  );

/** SDK errors can contain credentials, query variables, and private source data. */
export function linearFailure(
  error: unknown,
  options: { write?: boolean; message?: string } = {},
): OperationError {
  if (error instanceof OperationError) return error;
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
    return options.write
      ? uncertain()
      : new LinearServiceError(
          "Linear took too long to respond. Check your connection and refresh.",
          "timeout",
        );
  // Direct projected queries use the SDK's GraphQLClientError; normal SDK
  // methods already wrap that same response in LinearError.
  const source =
    error instanceof LinearError
      ? error
      : error instanceof Error
        ? parseLinearError(error)
        : null;
  if (!source) {
    if (options.write) return uncertain();
    return new LinearServiceError(
      options.message ??
        "Unable to reach Linear. Check your connection and refresh.",
      "unavailable",
    );
  }

  const write =
    Boolean(options.write) || /^\s*mutation\b/.test(source.query ?? "");
  // Partial mutation data does not establish which source changes completed.
  if (write && source.data != null) return uncertain();
  const status = source.status;
  if (
    status === 408 ||
    status === 504 ||
    source.type === LinearErrorType.LockTimeout
  )
    return write
      ? uncertain()
      : new LinearServiceError(
          "Linear took too long to respond. Check your connection and refresh.",
          "timeout",
        );
  if (status === 429 || source.type === LinearErrorType.Ratelimited)
    return new LinearServiceError(
      "Linear is temporarily limiting requests. Wait and refresh.",
      "rate-limited",
    );
  if (status === 404)
    return new LinearServiceError(
      "The Linear target was not found, or you cannot view it. Check its link and your access.",
      "not-found",
    );
  if (status === 409)
    return new LinearServiceError(
      "The Linear target changed while this operation was in progress. Refresh before trying again.",
      "conflict",
    );
  if (
    status === 400 ||
    status === 422 ||
    source.type === LinearErrorType.InvalidInput
  )
    return new LinearServiceError(
      "Linear rejected the supplied values. Check the selected target and fields.",
      "invalid-input",
    );
  if (status === 401 || source.type === LinearErrorType.AuthenticationError)
    return new LinearServiceError(
      "The Linear authorization is no longer valid. Reconnect to Linear.",
      "auth",
    );
  if (status === 403 || source.type === LinearErrorType.Forbidden)
    return new LinearServiceError(
      "Permission denied. Check your access to this Linear target.",
      "forbidden",
    );
  if (
    source.type === LinearErrorType.FeatureNotAccessible ||
    source.type === LinearErrorType.UsageLimitExceeded
  )
    return new LinearServiceError(
      "This operation is unavailable for the selected workspace. Check the workspace in Linear.",
      "unsupported",
    );
  if (write) return uncertain();
  return new LinearServiceError(
    options.message ??
      "Unable to load information from Linear. Check access and refresh.",
    "unavailable",
  );
}
