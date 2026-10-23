# Contributing

Thanks for helping make Pocket better.

## Before you start

- Read [docs/product/APP_SPEC.md](docs/product/APP_SPEC.md) and [docs/product/SYNC.md](docs/product/SYNC.md).
- Keep the app usable on a 390×844 phone; test at 320px width too.
- Never commit personal hostnames, device cookies, Tailscale addresses, or DSH installation artifacts.

## Development

~~~powershell
# UI preview
node .\scripts\serve-app.mjs .\app 8788

# Gateway tests
cd dsh-mobile
npm ci
node --test --test-isolation=none --test-force-exit tests/gateway.test.mjs tests/plugin.test.mjs tests/net.test.mjs tests/store.test.mjs tests/tunnel.test.mjs tests/notify.test.mjs
~~~

## Pull requests

- One focused change per PR; include screenshots/GIFs for UI changes.
- Describe the user problem, the change, and how you verified it.
- Do not add a dependency unless it removes more code than it adds.
- Keep the gateway protocol compatible with the installed DSH version; document breaking changes.

## Commit messages

Use a short imperative subject, then a body explaining why. Examples:

~~~text
fix(gateway): keep WebSocket alive through idle tunnels
feat(app): show approval cards inline
docs: document the follow snapshot merge rules
~~~

## Security

Do not open public issues for vulnerabilities. Use GitHub private security advisories.