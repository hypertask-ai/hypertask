const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/management-key-permissions.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  FULL_MANAGEMENT_KEY_PERMISSIONS,
  hasAnyManagementPermission,
  hasDataPermission,
  hasManagementReadPermission,
  hasManagementWritePermission,
  hasUsageReadPermission,
  isPermissionSubset,
  MANAGEMENT_KEY_PERMISSIONS,
  USAGE_READ_KEY_PERMISSIONS,
} = jiti(path.join(root, "src/lib/mcp/managementPermissions.ts"));

test("management scope is a subset of full scope", () => {
  assert.equal(
    isPermissionSubset(
      MANAGEMENT_KEY_PERMISSIONS,
      FULL_MANAGEMENT_KEY_PERMISSIONS
    ),
    true
  );
});

test("management-only key cannot grant full scope", () => {
  assert.equal(
    isPermissionSubset(
      FULL_MANAGEMENT_KEY_PERMISSIONS,
      MANAGEMENT_KEY_PERMISSIONS
    ),
    false
  );
});

test("scope subset requires every requested action", () => {
  assert.equal(
    isPermissionSubset(
      { management: ["read", "write"] },
      { management: ["read"] }
    ),
    false
  );
});

test("read-only management keys can read but cannot perform writes", () => {
  const permissions = { management: ["read"] };
  assert.equal(hasAnyManagementPermission(permissions), true);
  assert.equal(hasManagementReadPermission(permissions), true);
  assert.equal(hasManagementWritePermission(permissions), false);
});

test("write-only management keys can write but cannot perform reads", () => {
  const permissions = { management: ["write"] };
  assert.equal(hasAnyManagementPermission(permissions), true);
  assert.equal(hasManagementReadPermission(permissions), false);
  assert.equal(hasManagementWritePermission(permissions), true);
});

test("management-only htmk permissions are rejected for MCP data access", () => {
  assert.equal(hasDataPermission(MANAGEMENT_KEY_PERMISSIONS), false);
});

test("full htmk permissions allow MCP data access", () => {
  assert.equal(hasDataPermission(FULL_MANAGEMENT_KEY_PERMISSIONS), true);
});

test("usage keys can read usage but cannot access management or task data", () => {
  assert.equal(hasUsageReadPermission(USAGE_READ_KEY_PERMISSIONS), true);
  assert.equal(hasAnyManagementPermission(USAGE_READ_KEY_PERMISSIONS), false);
  assert.equal(hasDataPermission(USAGE_READ_KEY_PERMISSIONS), false);
});

test("management-only keys cannot read usage", () => {
  assert.equal(hasUsageReadPermission(MANAGEMENT_KEY_PERMISSIONS), false);
});

test("full keys and legacy full keys can read usage", () => {
  assert.equal(hasUsageReadPermission(FULL_MANAGEMENT_KEY_PERMISSIONS), true);
  assert.equal(
    hasUsageReadPermission({
      management: ["read", "write"],
      data: ["read", "write"],
    }),
    true,
  );
  for (const usage of [[], ["write"]]) {
    assert.equal(
      hasUsageReadPermission({
        management: ["read", "write"],
        data: ["read", "write"],
        usage,
      }),
      false,
    );
  }
});

test("usage permission is narrower than full access", () => {
  assert.equal(
    isPermissionSubset(USAGE_READ_KEY_PERMISSIONS, FULL_MANAGEMENT_KEY_PERMISSIONS),
    true,
  );
  assert.equal(
    isPermissionSubset(FULL_MANAGEMENT_KEY_PERMISSIONS, USAGE_READ_KEY_PERMISSIONS),
    false,
  );
});
