# Contributing to Hypertask

Thanks for wanting to help.

## Bugs and feature requests

Open a GitHub issue. For bugs, include what you did, what happened, and what you expected. A screenshot or a failing URL path helps more than a long description.

## Pull requests

1. Fork the repo and branch off `main`.
2. Keep the change small and focused. One fix or feature per PR.
3. Run the checks before pushing:
   ```bash
   npm run lint
   npm test
   npm run build
   ```
4. Open the PR against `main` with a short description of what changed and why.

Maintainers review PRs regularly. Small, well-scoped PRs get merged fastest.

## Development setup

Follow the self-hosting steps in the [README](README.md). `npm run dev` starts the app on `http://localhost:3000`.

## Security issues

Do not open a public issue for security vulnerabilities. Email security@hypertask.ai instead.

## License

By contributing, you agree that your contributions are licensed under the [AGPL-3.0](LICENSE).
