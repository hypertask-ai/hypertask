import axios from "axios";

export function planLimitRefusalMessage(error: unknown): string | null {
  if (
    !axios.isAxiosError(error) ||
    error.response?.status !== 402 ||
    error.response.data?.code !== "PLAN_LIMIT_REACHED"
  ) return null;

  return typeof error.response.data.message === "string"
    ? error.response.data.message
    : null;
}
