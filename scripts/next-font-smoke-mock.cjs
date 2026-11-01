const STYLESHEET =
  "@font-face { font-family: 'Smoke Font'; src: local('Arial'); }";

const STYLESHEET_URLS = [
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400;1,500&display=swap",
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@700&display=swap",
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap",
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,200..800;1,200..800&display=swap",
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100..700&display=swap",
];

module.exports = Object.fromEntries(
  STYLESHEET_URLS.map((url) => [url, STYLESHEET]),
);
