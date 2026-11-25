# Personal Drive — Troubleshooting & Operational Runbook

Common issues, diagnostics, and recovery solutions for home server operation.

---

## 1. Quick Diagnostics

Check overall system and service status:

```bash
# 1. Check container health
docker compose ps

# 2. Check application logs
docker compose logs --tail=100 -f app

# 3. Check database logs
docker compose logs --tail=100 -f db

# 4. Check API health endpoint
curl -s http://127.0.0.1:3000/api/health | jq .
```

---

## 2. Common Issues & Solutions

### A. "Port already allocated" on Docker start
- **Cause**: An existing PostgreSQL server is running on the host on port `5432` or `5433`.
- **Solution**:
  Check what process is using the port:
  ```bash
  lsof -i :5433
  ```
  Change `DB_PORT` in `.env.local` to an unused port (e.g. `5434` or `5435`) and run `docker compose up -d`.

### B. "503 Storage volume is unavailable"
- **Cause**: The external storage drive was unmounted or disconnected.
- **Solution**:
  1. Confirm the drive is physically attached and mounted:
     ```bash
     df -h
     ```
  2. Verify directory write permissions:
     ```bash
     ls -la "$DRIVE_STORAGE_PATH"
     ```
  3. Once reattached, the storage service automatically resumes accepting requests without requiring an application restart.

### C. "Upload rate limit exceeded" (429)
- **Cause**: More than 60 upload requests initiated within a 60-second window.
- **Solution**: Wait 60 seconds. The rate limiter will automatically reset its token bucket.

### D. "Unexpected end of form" on Large Video Uploads
- **Cause**: Proxy or middleware truncated streaming body.
- **Solution**: Personal Drive configures `proxyClientMaxBodySize: "10gb"` in `next.config.ts` and bypasses proxy middleware for `/api/` endpoints. Verify you are running with current configuration.

### E. Database Container Crash or Restart
- **Behavior**: The Next.js application maintains connection pooling with automated query retries.
- **Solution**:
  If Postgres is stopped, restart it with:
  ```bash
  docker compose restart db
  ```
  The app will re-establish connection within seconds.

---

## 3. Reconciling Database and Storage Discrepancies

If you suspect file records exist in the database without matching physical files (or vice versa):
1. Navigate to **Settings** > **Reconcile & Consistency Check**.
2. Click **Run Consistency Check**.
3. The engine scans all records and disk binaries, reporting orphan files and missing records with safe repair options.
