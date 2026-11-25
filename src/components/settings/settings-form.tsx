"use client";

import { useState, useEffect } from "react";
import {
  User,
  Lock,
  History,
  Trash2,
  Palette,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import { useTheme } from "next-themes";

interface SettingsData {
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  settings: {
    theme: string;
    trashRetentionDays: number;
    maxVersionsPerFile: number;
  };
}

export function SettingsForm() {
  const { setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [trashDays, setTrashDays] = useState(30);
  const [maxVersions, setMaxVersions] = useState(10);
  const [themePref, setThemePref] = useState("system");

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data: SettingsData = await res.json();
          setName(data.user.name || "");
          setEmail(data.user.email);
          setTrashDays(data.settings.trashRetentionDays);
          setMaxVersions(data.settings.maxVersionsPerFile);
          setThemePref(data.settings.theme);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          theme: themePref,
          trashRetentionDays: Number(trashDays),
          maxVersionsPerFile: Number(maxVersions),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update settings");

      setTheme(themePref);
      setFeedback({ type: "success", text: "Preferences saved successfully!" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving preferences";
      setFeedback({ type: "error", text: msg });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setFeedback({ type: "error", text: "Please enter your current password." });
      return;
    }
    if (newPassword.length < 8) {
      setFeedback({ type: "error", text: "New password must be at least 8 characters long." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFeedback({ type: "error", text: "New passwords do not match." });
      return;
    }

    setChangingPassword(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to change password");

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFeedback({ type: "success", text: "Password changed successfully!" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error changing password";
      setFeedback({ type: "error", text: msg });
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center text-muted-foreground text-sm">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" />
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
            feedback.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
              : "bg-destructive/10 text-destructive border-destructive/20"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Preferences & Retention Policies */}
      <form
        onSubmit={handleSavePreferences}
        className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-6"
      >
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Retention & Preferences
              </h2>
              <p className="text-xs text-muted-foreground">
                Configure file versioning depth, trash cleanup policy, and appearance
              </p>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Preferences
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Version Retention Limit */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              File Version Retention Limit
            </label>
            <select
              value={maxVersions}
              onChange={(e) => setMaxVersions(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={3}>Keep latest 3 versions per file</option>
              <option value={5}>Keep latest 5 versions per file</option>
              <option value={10}>Keep latest 10 versions per file (Recommended)</option>
              <option value={25}>Keep latest 25 versions per file</option>
              <option value={0}>Unlimited versions (Manual pruning only)</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Older versions exceeding this threshold are pruned from disk automatically upon uploading new revisions.
            </p>
          </div>

          {/* Trash Retention Policy */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
              Automatic Trash Retention Policy
            </label>
            <select
              value={trashDays}
              onChange={(e) => setTrashDays(Number(e.target.value))}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={0}>Keep indefinitely (Never auto-delete)</option>
              <option value={7}>Auto-delete after 7 days</option>
              <option value={30}>Auto-delete after 30 days (Standard)</option>
              <option value={60}>Auto-delete after 60 days</option>
              <option value={90}>Auto-delete after 90 days</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              Items in Trash older than this retention threshold are permanently deleted during maintenance.
            </p>
          </div>

          {/* User Display Name */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
              Display Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your Name"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Theme Preference */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-muted-foreground" />
              Theme Appearance
            </label>
            <select
              value={themePref}
              onChange={(e) => setThemePref(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="system">System Default</option>
              <option value="light">Light Theme</option>
              <option value="dark">Dark Theme</option>
            </select>
          </div>
        </div>
      </form>

      {/* Password Change Form */}
      <form
        onSubmit={handleChangePassword}
        className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-xs space-y-5"
      >
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Change Password</h2>
            <p className="text-xs text-muted-foreground">
              Update your account password with bcrypt salt verification
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Min. 8 characters"
              className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={changingPassword || !newPassword}
            className="px-4 py-2 rounded-lg bg-secondary text-secondary-foreground text-xs font-semibold hover:bg-secondary/80 transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {changingPassword ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Lock className="w-3.5 h-3.5" />
            )}
            Update Password
          </button>
        </div>
      </form>
    </div>
  );
}
