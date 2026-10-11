const Module = require("node:module");
const resolveFilename = Module._resolveFilename;

// Next aliases this build-time boundary to an empty module on the server.
Module._resolveFilename = function (specifier, ...args) {
  if (specifier === "server-only") return require.resolve("next/dist/compiled/server-only/empty");
  return resolveFilename.call(this, specifier, ...args);
};
