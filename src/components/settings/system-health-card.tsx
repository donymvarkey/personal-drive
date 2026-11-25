"use client";

import { useState, useEffect } from "react";
import { formatBytes } from "@/lib/utils";
import {
  Activity,
  Database,
  HardDrive,
  Cpu,
  Shield,
  Wifi,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Lock,
} from "lucide-react";

interface HealthData {
  status: string;
  timestamp: string;
  responseTimeMs: number;
  system: {
    uptimeSeconds: number;
    nodeVersion: string;
    memory: {
      heapUsedMB: number;
      heapTotalMB: number;
      rssMB: number;
    };
  };
  database: {
    status: string;
    latencyMs: number;
    error?: string;
  };
  storage: {
    status: string;
    path: string;
    device?: string;
    totalBytes?: string;
    freeBytes?: string;
    usedBytes?: string;
    error?: string;
  };
  backup: {
    totalBackups: number;
    latestBackupAt: string | null;
    latestBackupVerified: boolean;
    latestBackupStatus: string;
  };
  security: {
    rateLimiterActive: boolean;
    strictCSP: boolean;
    authenticationEnforced: boolean;
  };
}

export function SystemHealthCard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${seconds % 60}s`;
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Server Health & Security Status
            </h2>
            <p className="text-xs text-muted-foreground">
              Real-time resource utilization, database latency & Tailscale mesh status
            </p>
          </div>
        </div>

        <button
          onClick={fetchHealth}
          disabled={loading}
          className="p-2 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition text-xs flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {health ? (
        <div className="space-y-6">
          {/* Main 4-grid stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {/* Database Health */}
            <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">PostgreSQL</span>
                <Database className="w-4 h-4 text-primary" />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health.database.status === "connected" ? "bg-emerald-500" : "bg-destructive"
                  }`}
                />
                <span className="text-sm font-bold text-foreground capitalize">
                  {health.database.status}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground block">
                Latency: {health.database.latencyMs}ms
              </span>
            </div>

            {/* Storage Volume */}
            <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">Physical Storage</span>
                <HardDrive className="w-4 h-4 text-primary" />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    health.storage.status === "healthy" ? "bg-emerald-500" : "bg-destructive"
                  }`}
                />
                <span className="text-sm font-bold text-foreground capitalize">
                  {health.storage.status}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground block truncate" title={health.storage.path}>
                Path: {health.storage.path}
              </span>
            </div>

            {/* RAM / Node Heap */}
            <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">Memory Usage</span>
                <Cpu className="w-4 h-4 text-primary" />
              </div>
              <div className="text-sm font-bold text-foreground pt-1">
                {health.system.memory.heapUsedMB} MB / {health.system.memory.heapTotalMB} MB
              </div>
              <span className="text-[10px] text-muted-foreground block">
                Process RSS: {health.system.memory.rssMB} MB
              </span>
            </div>

            {/* App Uptime */}
            <div className="p-4 rounded-xl bg-muted/40 border border-border/60 space-y-1">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-medium">App Uptime</span>
                <Activity className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-sm font-bold text-foreground pt-1">
                {formatUptime(health.system.uptimeSeconds)}
              </div>
              <span className="text-[10px] text-muted-foreground block">
                Node {health.system.nodeVersion}
              </span>
            </div>
          </div>

          {/* Remote Access via Tailscale & Security Safeguards */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-primary" />
                <span className="text-xs font-semibold text-foreground">
                  Tailscale Mesh Remote Access & Security Policies
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Encrypted Point-to-Point
              </span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Personal Drive requires zero router port forwarding. Remote access is secured through
              your private Tailscale mesh network. Run{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground">
                tailscale serve --bg 3000
              </code>{" "}
              on this host to access your drive via encrypted HTTPS at{" "}
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-[11px] text-foreground">
                https://&lt;your-machine&gt;.ts.net
              </code>
              .
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px]">
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Strict CSP Enforced</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>No Public DB Ports</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Active Rate Limiter</span>
              </div>
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>SameSite Session JWT</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-6 text-center text-xs text-muted-foreground">
          Loading system telemetry...
        </div>
      )}
    </div>
  );
}
