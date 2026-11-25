# Personal Drive — Production Security Guide

Personal Drive is engineered with defense-in-depth principles across authentication, authorization, physical filesystem access, network boundaries, and active content neutralization.

---

## 1. Security Architecture Summary

| Layer | Implementation & Controls |
| :--- | :--- |
| **Authentication** | Single-owner Auth.js v5 JWT session. Passwords hashed with bcrypt (cost factor 12). Only `DRIVE_OWNER_EMAIL` can authenticate. |
| **Brute-Force Defense** | Sliding-window memory rate limiter: max 5 login attempts per 60s per account; max 60 uploads per 60s per user. |
| **Network Boundaries** | PostgreSQL is strictly bound to `127.0.0.1` or internal Docker network `personal_drive_net`. Database port is NEVER exposed to WAN. |
| **Remote Access** | Tailscale encrypted mesh network. No router port forwarding or UPnP required. |
| **Physical Storage** | Files stored outside web root with random UUID filenames. Physical directory paths never returned to clients. |
| **Active Content Neutralization** | Uploaded HTML, SVG, and JS files are neutralized to `text/plain` or served with sandboxed `Content-Security-Policy: default-src 'none'; sandbox`. |
| **Path Traversal Protection** | File operations normalize paths and enforce `storagePath` boundaries via `path.resolve` checks. |
| **HTTP Security Headers** | Strict CSP, HSTS, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. |
| **Safe Logging** | Structured JSON logging with automatic sanitization of passwords, tokens, auth headers, and secrets. |

---

## 2. File Upload & Storage Isolation

1. **UUID-Based Storage**:
   Uploaded files receive a fresh `crypto.randomUUID() + extension` filename on physical disk. A malicious file named `../../etc/cron.d/job` is sanitized to `job` and saved physically as `7f08376a-63f1-4c91-a8d4-86eab81d56d7.bin`.
2. **True MIME Type Verification**:
   Magic byte detection inspects the initial file chunks to prevent executable extension spoofing (e.g. an `.exe` disguised as a `.jpg`).
3. **No In-Place Overwrites**:
   Streaming writes to `.tmp/<uuid>.staging` and computes SHA-256 in flight. Only on completion is the file atomically finalized.

---

## 3. Remote Access & Reverse Proxy Security

### Recommended: Tailscale Serve
The simplest and most secure way to access your drive remotely is using Tailscale Serve:

```bash
# Expose port 3000 over Tailscale with automatic Let's Encrypt HTTPS
tailscale serve --bg 3000
```
This serves Personal Drive at `https://<machine-name>.<tailnet-name>.ts.net` with:
- Zero router port forwarding.
- Free, automatic Let's Encrypt TLS certificates.
- Access restricted exclusively to devices logged into your Tailscale network.

### Alternative: Caddy Reverse Proxy
If running Caddy on the host:
```caddy
drive.home.internal {
    reverse_proxy 127.0.0.1:3000
}
```

---

## 4. Production Checklist

- [x] Change default password on first login under Settings.
- [x] Generate a 32+ character random `AUTH_SECRET` via `openssl rand -base64 32`.
- [x] Ensure `DRIVE_STORAGE_PATH` and `DRIVE_BACKUP_PATH` are on separate physical drives.
- [x] Ensure PostgreSQL container port is NOT mapped to `0.0.0.0`.
- [x] Configure scheduled backup script in cron.
