import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineText = readFileSync(new URL("./soft-delete-reads-baseline.json", import.meta.url), "utf8");
const baseline = JSON.parse(baselineText);

const DEFAULT_CLIENTS = new Set(["prisma", "prismaClient", "tx", "db", "database", "client"]);
const SOFT_DELETE_DELEGATES = new Set(["task", "project"]);
const SOFT_DELETE_RELATIONS = new Set(["task", "tasks", "project", "projects"]);
const READ_METHODS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

const MESSAGES = {
  inlineDeletedRead:
    "Selecting Deleted rows inline mixes existence with the trash. Spread anyStatus from @/lib/db/softDeleteReads, then check the row's status (HTPR-9718).",
  searchStatusScope:
    "Pass excludeStatuses to this search call, for example excludeStatuses: [\"Deleted\"], so trashed tickets and boards cannot enter the results by accident (HTPR-9718).",
  deliveryUpdateAssumedRow:
    "A delivery row can be deleted while it is in flight. Use updateMany and treat count 0 as skipped, as HTPR-9085 does.",
};

function propertyName(node) {
  if (!node) return undefined;
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal") return String(node.value);
  return undefined;
}

function memberName(node) {
  if (node?.type !== "MemberExpression") return undefined;
  return propertyName(node.property);
}

function clientRoot(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression") return clientRoot(node.object);
  if (node?.type === "ChainExpression") return clientRoot(node.expression);
  return undefined;
}

function delegateModel(callee) {
  const delegate = callee?.type === "MemberExpression" ? callee.object : undefined;
  if (delegate?.type !== "MemberExpression") return undefined;
  const model = propertyName(delegate.property);
  return SOFT_DELETE_DELEGATES.has(model) ? model : undefined;
}

function objectArgument(call) {
  const first = call.arguments?.[0];
  return first?.type === "ObjectExpression" ? first : undefined;
}

function propertyOf(object, name) {
  return object?.properties.find((property) => property.type === "Property" && !property.computed && propertyName(property.key) === name);
}

function selectsDeleted(node) {
  if (!node) return false;
  if (node.type === "Literal" || node.type === "TemplateLiteral") return node.value === "Deleted" || node.quasis?.some((quasi) => quasi.value.cooked === "Deleted");
  if (node.type === "MemberExpression") return propertyName(node.property) === "Deleted";
  if (node.type !== "ObjectExpression") return false;
  const equals = propertyOf(node, "equals");
  if (equals && selectsDeleted(equals.value)) return true;
  const within = propertyOf(node, "in");
  const list = within?.value;
  return list?.type === "ArrayExpression" && list.elements.some((element) => selectsDeleted(element));
}

function* nestedProperties(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "ObjectExpression") {
    for (const property of node.properties) {
      yield property;
      yield* nestedProperties(property.value);
    }
    return;
  }
  if (node.type === "ArrayExpression") {
    for (const element of node.elements) yield* nestedProperties(element);
  }
}

function selectsDeletedInRelation(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type !== "ObjectExpression") return false;
  return [...nestedProperties(node)].some((property) => {
    if (!SOFT_DELETE_RELATIONS.has(propertyName(property.key))) return false;
    const relation = property.value.type === "ObjectExpression" ? property.value : undefined;
    const where = propertyOf(relation, "where");
    const whereObject = where?.value.type === "ObjectExpression" ? where.value : undefined;
    return selectsDeleted(propertyOf(whereObject, "status")?.value);
  });
}

function readCall(node) {
  if (node.type !== "CallExpression") return undefined;
  const method = memberName(node.callee);
  if (!READ_METHODS.has(method)) return undefined;
  if (!delegateModel(node.callee)) return undefined;
  if (!DEFAULT_CLIENTS.has(clientRoot(node.callee))) return undefined;
  return node;
}

function baselinedRule({ name, messageId, collect }) {
  return {
    meta: { type: "problem", schema: [], messages: { [messageId]: MESSAGES[messageId] } },
    create(context) {
      const nodes = [];
      return {
        ...collect(nodes),
        "Program:exit"() {
          const file = path.relative(root, context.filename).split(path.sep).join("/");
          const allowance = baseline[file]?.[name] ?? 0;
          for (const node of nodes.sort((a, b) => a.range[0] - b.range[0]).slice(allowance)) {
            context.report({ node, messageId });
          }
        },
      };
    },
  };
}

const inlineDeletedRead = baselinedRule({
  name: "no-inline-deleted-read",
  messageId: "inlineDeletedRead",
  collect(nodes) {
    return {
      CallExpression(node) {
        if (!readCall(node)) return;
        const scope = objectArgument(node);
        if (!scope) return;
        const where = propertyOf(scope, "where");
        const whereObject = where?.value.type === "ObjectExpression" ? where.value : undefined;
        if (selectsDeleted(propertyOf(whereObject, "status")?.value)) {
          nodes.push(node);
          return;
        }
        if (selectsDeletedInRelation(scope)) nodes.push(node);
      },
    };
  },
});

const searchStatusScope = baselinedRule({
  name: "search-status-scope",
  messageId: "searchStatusScope",
  collect(nodes) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier") return;
        if (!["searchTasks", "searchComments"].includes(node.callee.name)) return;
        const scope = objectArgument(node);
        if (!scope) return;
        if (propertyOf(scope, "excludeStatuses") || propertyOf(scope, "status")) return;
        nodes.push(node);
      },
    };
  },
});

const deliveryUpdateAssumedRow = baselinedRule({
  name: "no-delivery-update-assumed-row",
  messageId: "deliveryUpdateAssumedRow",
  collect(nodes) {
    return {
      CallExpression(node) {
        if (memberName(node.callee) !== "update") return;
        const delegate = node.callee.type === "MemberExpression" ? node.callee.object : undefined;
        if (memberName(delegate) !== "agentWebhookDelivery") return;
        if (!DEFAULT_CLIENTS.has(clientRoot(delegate))) return;
        nodes.push(node);
      },
    };
  },
});

export const softDeleteReadsLintConfig = {
  files: ["src/**/*.{ts,tsx}"],
  plugins: {
    "hypertask-soft-delete": {
      meta: {
        name: "hypertask-soft-delete",
        version: createHash("sha256").update(readFileSync(new URL(import.meta.url))).update(baselineText).digest("hex"),
      },
      rules: {
        "no-inline-deleted-read": inlineDeletedRead,
        "search-status-scope": searchStatusScope,
        "no-delivery-update-assumed-row": deliveryUpdateAssumedRow,
      },
    },
  },
  rules: {
    "hypertask-soft-delete/no-inline-deleted-read": "error",
    "hypertask-soft-delete/search-status-scope": "error",
    "hypertask-soft-delete/no-delivery-update-assumed-row": "error",
  },
};
