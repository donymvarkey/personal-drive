# Personal Drive — Remote Access via Tailscale Guide

Personal Drive is designed to operate securely across the internet without opening any ports on your home router or exposing your home server to the public WAN.

---

## 1. Why Tailscale?

- **Zero Port Forwarding**: Protects your home IP address and prevents port-scanning attacks.
- **End-to-End Encryption**: Data between your phone, laptop, and home server is encrypted with WireGuard.
- **Automated TLS**: Tailscale Serve provides free Let's Encrypt certificates for `*.ts.net` hostnames.
- **Dual-Layer Security**: Tailscale provides network layer encryption; Personal Drive requires application-level authentication.

---

## 2. Setup Step-by-Step

### Step 1: Install Tailscale on the Home Server
Follow the official instructions for your OS:
- **macOS**: Install from the Mac App Store or download from `tailscale.com`.
- **Linux (Debian/Ubuntu)**:
  ```bash
  curl -fsSL https://tailscale.com/install.sh | sh
  sudo tailscale up
  ```

### Step 2: Enable Tailscale Serve
Once your machine is joined to your Tailscale tailnet:

```bash
# Expose Next.js port 3000 over encrypted Tailscale HTTPS
tailscale serve --bg 3000
```

Tailscale will display your secure URL:
```
Available within your tailnet:
https://home-server.your-tailnet.ts.net
```

### Step 3: Update `NEXTAUTH_URL`
In your `.env` (or `.env.local`):
```ini
NEXTAUTH_URL="https://home-server.your-tailnet.ts.net"
```
Restart the application container:
```bash
docker compose restart app
```

---

## 3. Verifying Remote Access
1. Install Tailscale on your mobile device (iOS/Android) or laptop.
2. Sign in with the same Tailscale account.
3. Open `https://home-server.your-tailnet.ts.net` in any browser.
4. Log in with your Personal Drive owner credentials.
5. Large file uploads, downloads, video streaming, and backups work seamlessly over the encrypted tunnel!
