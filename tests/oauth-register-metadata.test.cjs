const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let created;

require.cache[path.join(root, "src/lib/prisma.ts")] = {
  id: path.join(root, "src/lib/prisma.ts"),
  filename: path.join(root, "src/lib/prisma.ts"),
  loaded: true,
  exports: {
    default: {
      oAuthClient: {
        create: async ({ data }) => {
          created = data;
          return data;
        },
      },
    },
  },
};

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { POST } = jiti(path.join(root, "src/app/oauth/register/route.ts"));

function request(body) {
  return new NextRequest("https://app.hypertask.ai/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validMetadata = {
  client_name: "Claude",
  redirect_uris: ["https://claude.ai/api/mcp/callback"],
  grant_types: ["authorization_code"],
  token_endpoint_auth_method: "none",
};

test("dynamic registration accepts the public-client metadata used by chat connectors", async () => {
  created = undefined;
  const response = await POST(request(validMetadata));

  assert.equal(response.status, 201);
  assert.equal(created.client_name, "Claude");
  assert.deepEqual(created.redirect_uris, validMetadata.redirect_uris);
  assert.equal(created.token_endpoint_auth_method, "none");
});

test("dynamic registration rejects private-client auth metadata", async () => {
  created = undefined;
  const response = await POST(
    request({ ...validMetadata, token_endpoint_auth_method: "client_secret_basic" }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_client_metadata");
  assert.equal(created, undefined);
});

test("dynamic registration rejects redirect fragments", async () => {
  created = undefined;
  const response = await POST(
    request({
      ...validMetadata,
      redirect_uris: ["https://claude.ai/api/mcp/callback#fragment"],
    }),
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_redirect_uri");
  assert.equal(created, undefined);
});
