const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "../..");
const directory = path.join(root, "src/lib/flags/definitions");
const load = createJiti(__filename, { interopDefault: true });
const paths = () => fs.readdirSync(directory).filter((name) => name !== "index.generated.ts").sort();

exports.definitions = () => paths().map((name) => load(path.join(directory, name)).default);
exports.source = () => paths().map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("\n");
exports.load = (relative) => load(path.isAbsolute(relative) ? relative : path.join(root, relative));
