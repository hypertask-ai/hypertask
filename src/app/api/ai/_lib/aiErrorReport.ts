import { classifySafeProviderError } from "@/app/api/ai/_lib/aiFunding";
import { reportError } from "@/lib/errors/reportError";

export async function reportAiRequestError(args: {
  url: string;
  stage: string;
  label?: string;
  error?: unknown;
  minimumOccurrences?: number;
}): Promise<void> {
  const errorClass = classifySafeProviderError(args.error);
  await reportError({
    message: `${args.label ?? "AI request failed"} (${errorClass})`,
    url: args.url,
    source: "handled",
    extra: { stage: args.stage, errorClass },
    fingerprintKey: `ai-error:${args.url}:${args.stage}:${errorClass}`,
    ...(args.minimumOccurrences === undefined ? {} : { minimumOccurrences: args.minimumOccurrences }),
  }).catch(() => undefined);
}
