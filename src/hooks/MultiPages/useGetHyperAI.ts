import { getHyperRoute } from "@/lib/constants/APIRouteConstants";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

export const useGetHyperAI = (
  initialData?: any,
  options?: { enabled?: boolean },
) => {
  return useQuery({
    queryKey: ["hyper-ai"],
    queryFn: () => getHyperObject(),
    enabled: options?.enabled ?? true,
    initialData: initialData ?? [],
  });
};

export const getHyperObject = async () => {
  try {
    const hyper = await axios.get(getHyperRoute);
    return hyper.data;
  } catch (error) {
    console.log("🤔 ~ getHyperObject ~ error:", error);
    throw error;
  }
};
