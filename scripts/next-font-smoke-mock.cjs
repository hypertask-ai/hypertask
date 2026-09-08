// next/font accepts this built-in test hook instead of downloading Google fonts.
// ponytail: this checks font imports and CSS generation, not the remote font files;
// remove it when the app vendors its production fonts locally.
module.exports = new Proxy(
  {},
  {
    get: () => "@font-face { font-family: 'Smoke Font'; src: local('Arial'); }",
  },
);
