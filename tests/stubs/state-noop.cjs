const { atom: jotaiAtom } = require("jotai");

const atom = (options) => jotaiAtom(options.default);

const recoilPersist = () => ({ persistAtom: () => undefined });

const selectorFamily = (options) => (param) =>
  jotaiAtom((get) => options.get(param)({ get }));

module.exports = { atom, recoilPersist, selectorFamily };
