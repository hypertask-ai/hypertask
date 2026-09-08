import http from "node:http";
import net from "node:net";

const registry = "registry.npmjs.org";
const allowedTarget = `${registry}:443`;
const port = Number.parseInt(process.env.SMOKE_PROXY_PORT ?? "3128", 10);
const host = process.env.SMOKE_PROXY_HOST;
const token = process.env.SMOKE_PROXY_TOKEN;

if (!host) throw new Error("SMOKE_PROXY_HOST is required");
if (!token) throw new Error("SMOKE_PROXY_TOKEN is required");
const authorization = `Basic ${Buffer.from(`smoke:${token}`).toString("base64")}`;

const server = http.createServer((_request, response) => {
  response.writeHead(403);
  response.end();
});

server.on("connect", (request, client, head) => {
  if (request.url !== allowedTarget) {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  if (request.headers["proxy-authorization"] !== authorization) {
    client.end(
      'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="smoke"\r\n\r\n',
    );
    return;
  }

  const upstream = net.connect(443, registry, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.setTimeout(30_000, () => {
    upstream.destroy();
    client.destroy();
  });
  upstream.on("error", () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"));
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
});

server.listen(port, host, () => {
  console.log(`PORT=${server.address().port}`);
});
