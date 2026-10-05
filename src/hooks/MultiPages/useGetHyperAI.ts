import { getHyperRoute } from "@/lib/constants/APIRouteConstants";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import axios from "axios";
import { consumeEarlyAppShellBootstrapSlice } from "@/lib/appShellBootstrap/client";

export const useGetHyperAI = (
  initialData?: any,
  options?: { enabled?: boolean; notifyOnChangeProps?: UseQueryOptions["notifyOnChangeProps"] },
) => {
  return useQuery({
    queryKey: ["hyper-ai"],
    queryFn: () => getHyperObject(),
    enabled: options?.enabled ?? true,
    ...(options?.notifyOnChangeProps === undefined
      ? {}
      : { notifyOnChangeProps: options.notifyOnChangeProps }),
    initialData: initialData ?? [],
  });
};

export const getHyperObject = async () => {
  try {
    const bootstrapped =
      await consumeEarlyAppShellBootstrapSlice<Record<string, unknown>>("hyperAi");
    if (bootstrapped && !Array.isArray(bootstrapped)) return bootstrapped;
    const hyper = await axios.get(getHyperRoute);
    return hyper.data;
  } catch (error) {
    console.log("🤔 ~ getHyperObject ~ error:", error);
    throw error;
  }
};
