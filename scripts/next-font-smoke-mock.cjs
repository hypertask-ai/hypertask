const face = (family, weight, style = "normal") =>
  `@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: local('Arial');\n}`;

const inter = face("Inter", "100 900");
const newsreader = `${face("Newsreader", "200 800")}\n${face("Newsreader", "200 800", "italic")}`;
const loginNewsreader = [
  face("Newsreader", "400"),
  face("Newsreader", "500"),
  face("Newsreader", "400", "italic"),
  face("Newsreader", "500", "italic"),
].join("\n");
const plexMono = face("IBM Plex Mono", "700");
const plexSans = face("IBM Plex Sans", "100 700");

module.exports = {
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap": inter,
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,200..800;1,200..800&display=swap": newsreader,
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,500;1,400;1,500&display=swap": loginNewsreader,
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@700&display=swap": plexMono,
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100..700&display=swap": plexSans,
};
