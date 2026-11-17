const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
jiti("../ensureFlagIndex.ts");
module.exports = jiti("./index.generated.ts");
