import { Data } from "effect";
export class ApplicationError extends Data.TaggedError("ApplicationError")<{
  message: string;
}> {}

export class HostError extends Data.TaggedError("HostError")<{
  message: string;
}> {}
export class ScanError extends Data.TaggedError("ScanError")<{
  message: string;
}> {}
export class ActionError extends Data.TaggedError("ActionError")<{
  message: string;
}> {}
export class AgentError extends Data.TaggedError("AgentError")<{
  message: string;
}> {}
export class DescribeError extends Data.TaggedError("DescribeError")<{
  message: string;
}> {}
export class JevError extends Data.TaggedError("JevError")<{
  message: string;
}> {}
export class SettingsError extends Data.TaggedError("SettingsError")<{
  message: string;
}> {}
export class DbError extends Data.TaggedError("DbError")<{ message: string }> {}

export class DeletionConfirmationError extends Data.TaggedError(
  "DeletionConfirmationError",
)<{ message: string }> {}
