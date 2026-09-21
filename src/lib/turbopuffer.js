import { env as appEnv } from "#env";
import Turbopuffer from "@turbopuffer/turbopuffer";
import { searchConfig } from "./configs/search.config";

export const turbopufferNamespaces = {
  task: {
    name: "tasks",
    legacyAlias: searchConfig.collections.task.alias,
    legacyName: searchConfig.collections.task.name,
  },
  comment: {
    name: "comments",
    legacyAlias: searchConfig.collections.comment.alias,
    legacyName: searchConfig.collections.comment.name,
  },
  page: {
    name: "pages",
  },
  customInstructionFile: {
    name: "custom-instruction-files",
  },
};

const clientOptions = {
  apiKey: appEnv.TURBOPUFFER_API_KEY || "missing",
};

if (appEnv.TURBOPUFFER_BASE_URL) {
  clientOptions.baseURL = appEnv.TURBOPUFFER_BASE_URL;
  clientOptions.region = null;
} else {
  clientOptions.region = appEnv.TURBOPUFFER_REGION || "aws-eu-west-1";
}

const turbopuffer = new Turbopuffer(clientOptions);

export default turbopuffer;
