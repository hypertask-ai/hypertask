# Hypertask

Open-source project and task management, built for teams that work with AI agents as much as with people.

Hypertask is a kanban-style task manager with real-time collaboration, rich-text tickets, an AI chat that can act on your board, and an MCP server so coding agents can read and update tasks the same way humans do.

The hosted version runs at [hypertask.ai](https://hypertask.ai). This repository contains the full core application, and you can self-host it.

## Features

- Kanban boards with sections, labels, assignees, priorities, and manual or automatic sorting
- Rich-text task descriptions and comments (Tiptap, collaborative via Yjs)
- Real-time updates across clients
- AI chat that can create, move, and edit tasks
- MCP server built in: connect Claude, Cursor, or any MCP client to your boards
- Full-text and semantic search
- Calendar, inbox, and notification views
- Google sign-in and email magic links

## Tech stack

Next.js 14 (App Router), PostgreSQL with Prisma, Recoil + TanStack Query, Tailwind CSS, Tiptap/Yjs, Stripe for billing on the hosted version.

## Self-hosting

Requirements: Node 20+, PostgreSQL 15+.

```bash
git clone https://github.com/hypertask-ai/hypertask.git
cd hypertask
cp .env.example .env   # fill in DATABASE_URL, JWT_SECRET (32+ chars), and the services you use
npm install
npx prisma migrate deploy
npm run dev
```

See [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) for the full list of environment variables. Optional integrations (Firebase auth, SendGrid/Resend email, Stripe, AI providers) each have their own setup doc in the repo root and `docs/`.

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[AGPL-3.0](LICENSE). You can use, modify, and self-host Hypertask freely. If you run a modified version as a service, you must publish your modifications under the same license.
