const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { QueryClient, QueryObserver } = require("@tanstack/react-query");

const root = path.join(__dirname, "..");
const jiti = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
  cache: false,
});
const { setTaskLabelsQueryData, taskLabelsQueryKey } = jiti(
  path.join(root, "src/hooks/MultiPages/useGetAllTaskLabels.ts"),
);

test("new task labels are published to the task detail Tags query immediately", () => {
  const taskId = 6525;
  const taskLabels = [
    { id: 91, taskId, labelId: 27, label: { id: 27, value: "verified" } },
  ];
  const queryClient = new QueryClient();
  const observer = new QueryObserver(queryClient, {
    queryKey: taskLabelsQueryKey(taskId),
    queryFn: async () => [],
    enabled: false,
    initialData: [],
  });

  const observed = [];
  const unsubscribe = observer.subscribe((result) => observed.push(result.data));
  setTaskLabelsQueryData(queryClient, taskId, taskLabels);

  assert.deepEqual(observer.getCurrentResult().data, taskLabels);
  assert.deepEqual(observed.at(-1), taskLabels);
  unsubscribe();
  queryClient.clear();
});
