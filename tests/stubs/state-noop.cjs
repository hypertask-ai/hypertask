// Minimal stand-in for src/lib/state.tsx in Node tests. That module is a .tsx file
// whose JSX cannot be parsed by jiti, but the store only needs these three exports.
// The real tasksPlayListAtom under test uses jotai/utils directly, not this shim.
const { atom: jotaiAtom } = require("jotai");

const atom = (options) => jotaiAtom(options.default);

const recoilPersist = () => ({ persistAtom: () => undefined });

const selectorFamily = (options) => (param) =>
  jotaiAtom((get) => options.get(param)({ get }));

module.exports = { atom, recoilPersist, selectorFamily };
