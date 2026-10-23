# Security policy

## Reporting

Please use GitHub's **private security advisory** for this repository.
Do not include device cookies, pairing tokens, tunnel tokens, or personal hostnames in a public issue.

## Threat model

Pocket exposes a phone-friendly surface over a DSH instance that may be reachable from the public internet.

Assets to protect:

- DSH launch token and upstream signed cookie (must never reach the phone).
- Device tokens (server stores only SHA-256; revocable per device).
- Tool arguments and file contents shown in sessions.
- Pairing tokens (one-time, short-lived).

Controls:

- Pairing requires an explicit approval on the desktop; tokens are single-use and rate-limited.
- Every phone request is authenticated by a device cookie; revocation closes live WebSockets.
- Public access must be HTTPS. HTTP is only acceptable on a trusted LAN.
- Approval outcomes are one-shot; there is no "allow forever" grant.
- Notifications default to tool name + session title, not full command output.
- The app does not load third-party analytics or remote scripts.

## Known limitations

- A compromised phone can read every session visible to its device token.
- Push delivery depends on the browser/OS vendor (FCM/APNs); Pocket cannot guarantee delivery.
- The gateway is a reverse proxy: a DSH vulnerability is still reachable through it.
