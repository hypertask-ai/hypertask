module.exports = function plexPreloadLoader(css, map, meta) {
  const request = JSON.parse(this.resourceQuery.slice(1));
  if (request.import === "IBM_Plex_Sans" && request.path.replaceAll("\\", "/") === "src/lib/fonts/ibmPlexSans.ts") {
    const hrefs = new Set();
    let subset;
    for (const node of meta.ast.root.nodes) {
      if (node.type === "comment") subset = node.text.trim();
      if (subset !== "latin" || node.type !== "atrule" || node.name !== "font-face") continue;
      const src = node.nodes.find(decl => decl.prop === "src")?.value;
      const href = /^url\((['"]?)([^'"()]+)\1\)/.exec(src ?? "")?.[2];
      if (href) hrefs.add(href);
    }
    if (!hrefs.size && this.mode === "development") return this.callback(null, css, map, meta);
    if (hrefs.size !== 1) throw new Error("Plex preload requires exactly one emitted Latin font URL");
    meta.exports.push({ name: "preloadHref", value: [...hrefs][0] });
  }
  this.callback(null, css, map, meta);
};
