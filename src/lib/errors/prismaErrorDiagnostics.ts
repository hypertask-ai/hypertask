function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedJson(value: unknown, maxLength = 4000) {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return undefined;
  }
}

export function prismaErrorDiagnostics(error: unknown) {
  const candidate = record(error);
  if (
    !candidate ||
    typeof candidate.code !== "string" ||
    !/^P\d{4}$/.test(candidate.code)
  ) {
    return {};
  }

  const diagnostics: Record<string, string | number | boolean | null> = {
    prismaCode: candidate.code.slice(0, 40),
  };

  if (typeof candidate.clientVersion === "string") {
    diagnostics.prismaClientVersion = candidate.clientVersion.slice(0, 40);
  }
  if (typeof candidate.batchRequestIdx === "number") {
    diagnostics.prismaBatchRequestIndex = candidate.batchRequestIdx;
  }

  const meta = boundedJson(candidate.meta);
  if (meta) diagnostics.prismaMeta = meta;

  return diagnostics;
}
