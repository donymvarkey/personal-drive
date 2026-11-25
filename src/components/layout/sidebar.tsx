"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard,
  FolderOpen,
  Clock,
  Star,
  Trash2,
  Settings,
  HardDrive,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Shield,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "My Files", href: "/files", icon: FolderOpen },
  { label: "Recent", href: "/recent", icon: Clock },
  { label: "Starred", href: "/starred", icon: Star },
  { label: "Trash", href: "/trash", icon: Trash2 },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col h-full bg-sidebar border-r border-sidebar-border transition-all duration-300 select-none z-20",
        collapsed ? "w-18" : "w-64"
      )}
    >
      {/* Brand Header */}
      <div className="flex items-center justify-between p-4 border-b border-sidebar-border h-16">
        <Link href="/dashboard" className="flex items-center gap-3 overflow-hidden">
          <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground shadow-xs">
            <HardDrive className="w-5 h-5" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="font-bold text-sm tracking-tight text-sidebar-foreground block truncate">
                Personal Drive
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider block font-semibold">
                Self-Hosted
              </span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation List */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1.5">
        {!collapsed && (
          <p className="px-3 pb-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            Navigation
          </p>
        )}

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-xs"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon
                className={cn(
                  "w-4 h-4 flex-shrink-0 transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground group-hover:text-sidebar-foreground"
                )}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User & Collapse Footer */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        {!collapsed && session?.user && (
          <div className="flex items-center gap-3 p-2 rounded-xl bg-sidebar-accent/50">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold text-xs flex-shrink-0">
              {session.user.name ? session.user.name.charAt(0).toUpperCase() : "O"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-sidebar-foreground truncate">
                {session.user.name}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {session.user.email}
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {!collapsed && (
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Log out</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
