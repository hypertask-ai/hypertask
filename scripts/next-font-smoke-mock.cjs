module.exports = new Proxy(
  {},
  {
    get: () => "@font-face { font-family: 'Smoke Font'; src: local('Arial'); }",
  },
);
