import axios from "axios";

const viewOrderSaveQueues = new Map<number, Promise<string[]>>();

export const saveViewOrder = async (projectId: number, viewOrder: string[]) => {
  const previousSave = viewOrderSaveQueues.get(projectId);
  const queuedSave = (previousSave
    ? previousSave.catch(() => [])
    : Promise.resolve([])
  ).then(async () => {
    const response = await axios.post("/api/projects/views/update-order", {
      projectId,
      viewOrder,
    });
    return response.data.viewOrder as string[];
  });
  viewOrderSaveQueues.set(projectId, queuedSave);

  try {
    return await queuedSave;
  } finally {
    if (viewOrderSaveQueues.get(projectId) === queuedSave) {
      viewOrderSaveQueues.delete(projectId);
    }
  }
};

export const resetViewOrder = async (projectId: number) => {
  await axios.post("/api/projects/views/reset-order", { projectId });
};

export const setDefaultViewOrder = async (
  projectId: number,
  viewOrder: string[]
) => {
  const response = await axios.post("/api/projects/views/set-default-order", {
    projectId,
    viewOrder,
  });
  return response.data.defaultViewOrder as string[];
};
