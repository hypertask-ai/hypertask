type DiagnosticNode = {
  nodeName?: string;
  nodeType?: number;
  id?: string;
  classList?: Iterable<string>;
};

type DiagnosticMutation = {
  type: string;
  target: DiagnosticNode;
  attributeName?: string | null;
  addedNodes?: ArrayLike<DiagnosticNode>;
  removedNodes?: ArrayLike<DiagnosticNode>;
};

const SHARE_PATH = /^\/share(?:\/|$)/;
const HYDRATION_ERROR = /(?:Minified React error #418|Hydration failed)/i;

export function isShareHydrationError(message: string, pathname: string) {
  return SHARE_PATH.test(pathname) && HYDRATION_ERROR.test(message);
}

function describeNode(node: DiagnosticNode | undefined) {
  if (!node) return "unknown";
  if (node.nodeType === 3) return "#text";

  const name = (node.nodeName || "unknown").toLowerCase();
  // Record that an ID exists, never its value: task titles and emails can
  // legally appear in DOM attributes supplied by third-party content.
  const id = node.id ? "#id" : "";
  const classes = node.classList
    ? Array.from(node.classList).slice(0, 2).join(".")
    : "";
  return `${name}${id}${classes ? `.${classes}` : ""}`.slice(0, 120);
}

function describeNodes(nodes: ArrayLike<DiagnosticNode> | undefined) {
  return Array.from(nodes || [])
    .slice(0, 4)
    .map(describeNode)
    .join(",");
}

export function summarizeHydrationMutation(record: DiagnosticMutation) {
  const target = describeNode(record.target);
  if (record.type === "attributes") {
    return `attr:${target}:${record.attributeName || "unknown"}`;
  }

  const added = describeNodes(record.addedNodes);
  const removed = describeNodes(record.removedNodes);
  return `children:${target}:added=${added || "none"}:removed=${removed || "none"}`;
}
