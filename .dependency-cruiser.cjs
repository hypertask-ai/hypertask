module.exports = {
  forbidden: [{
    name: 'board-registration-boundary',
    severity: 'error',
    from: { path: '^src/components/Modals/commands/HTC/domains/boardCommands\\.(ts|tsx)$' },
    to: {
      path: '^src/',
      pathNot: '^(src/components/Modals/commands/HTC/domains/boardCommands\\.(ts|tsx)$|src/components/Modals/commands/HTC/HTCTypes\\.(ts|tsx)$|src/models/(enums|model)\\.(ts|tsx)$)',
    },
  }],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: { fileName: 'tsconfig.json' } },
};
