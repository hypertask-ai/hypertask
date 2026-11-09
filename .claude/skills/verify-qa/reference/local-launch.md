# Local launch and teardown

Use this to prove a change locally. It starts an empty Postgres in a throwaway
Docker volume, never a Neon branch or production data. Export `DATABASE_URL`
in this shell only; do not edit `.env.local`.

```bash
docker volume create hypertask-verify-db
docker run -d --name hypertask-verify-db \
  -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=hypertask \
  -p 5678:5432 postgres:14.0-alpine
export DATABASE_URL=postgresql://verify:verify@127.0.0.1:5678/hypertask
npx prisma generate
npx prisma migrate deploy
BETTER_AUTH_SECRET=local-placeholder-at-least-32-characters \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 npx next dev -p 3000
```

Stop the dev server with Ctrl+C, then remove the instance and its data:

```bash
docker rm -f hypertask-verify-db
docker volume rm hypertask-verify-db
```

The next launch repeats from an empty database. If port 5678 or 3000 is busy,
pick another free port and change both the publish and the URL. This recipe
needs no Vercel, Stripe, Resend, realtime or production credential.
