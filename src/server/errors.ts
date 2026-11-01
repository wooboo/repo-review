import { Data } from "effect";
export class ApplicationError extends Data.TaggedError("ApplicationError")<{
  message: string;
}> {}
