import { useCallback } from "react";
import toast from "react-hot-toast";
import { useRecoilValue, useSetRecoilState } from "@/lib/state";
import {
  optimisticViewTabsOrderAtom,
  viewTabsOrderAtom,
} from "@/store";
import {
  resetViewOrder,
  saveViewOrder,
  setDefaultViewOrder,
} from "@/utils/api/viewOrder";

const useViewOrderActions = (projectId: number | undefined) => {
  const persistedOrders = useRecoilValue(viewTabsOrderAtom);
  const setPersistedOrders = useSetRecoilState(viewTabsOrderAtom);
  const setOptimisticOrders = useSetRecoilState(optimisticViewTabsOrderAtom);

  const saveMyViewOrder = useCallback(
    async (viewOrder: string[]) => {
      if (!projectId) return;
      const hadPreviousOrder = Object.prototype.hasOwnProperty.call(
        persistedOrders,
        projectId
      );
      const previousOrder = persistedOrders[projectId];
      setPersistedOrders((orders) => ({ ...orders, [projectId]: viewOrder }));
      setOptimisticOrders((orders) => ({ ...orders, [projectId]: viewOrder }));
      try {
        await saveViewOrder(projectId, viewOrder);
        return true;
      } catch (error) {
        setPersistedOrders((orders) => {
          if (orders[projectId] !== viewOrder) return orders;
          const next = { ...orders };
          if (hadPreviousOrder) next[projectId] = previousOrder;
          else delete next[projectId];
          return next;
        });
        setOptimisticOrders((orders) => {
          if (orders[projectId] !== viewOrder) return orders;
          const next = { ...orders };
          delete next[projectId];
          return next;
        });
        toast.error("Unable to save view order");
        return false;
      }
    },
    [persistedOrders, projectId, setOptimisticOrders, setPersistedOrders]
  );

  const resetMyViewOrder = useCallback(
    async (fallbackOrder: string[], hasProjectDefault: boolean) => {
      if (!projectId) return;
      const hadPreviousOrder = Object.prototype.hasOwnProperty.call(
        persistedOrders,
        projectId
      );
      const previousOrder = persistedOrders[projectId];
      setPersistedOrders((orders) => {
        const next = { ...orders };
        if (hasProjectDefault) next[projectId] = fallbackOrder;
        else delete next[projectId];
        return next;
      });
      setOptimisticOrders((orders) => ({
        ...orders,
        [projectId]: fallbackOrder,
      }));
      try {
        await resetViewOrder(projectId);
        return true;
      } catch (error) {
        setPersistedOrders((orders) => {
          if (orders[projectId] !== fallbackOrder) return orders;
          const next = { ...orders };
          if (hadPreviousOrder) next[projectId] = previousOrder;
          else delete next[projectId];
          return next;
        });
        setOptimisticOrders((orders) => {
          if (orders[projectId] !== fallbackOrder) return orders;
          const next = { ...orders };
          delete next[projectId];
          return next;
        });
        toast.error("Unable to reset view order");
        return false;
      }
    },
    [persistedOrders, projectId, setOptimisticOrders, setPersistedOrders]
  );

  const saveProjectDefault = useCallback(
    async (viewOrder: string[]) => {
      if (!projectId) return undefined;
      try {
        return await setDefaultViewOrder(projectId, viewOrder);
      } catch (error) {
        toast.error("Unable to set the default view order");
        return undefined;
      }
    },
    [projectId]
  );

  return { resetMyViewOrder, saveMyViewOrder, saveProjectDefault };
};

export default useViewOrderActions;
