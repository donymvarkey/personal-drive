"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  Search,
  ChevronRight,
  Home,
  User,
  LogOut,
  ShieldCheck,
  HardDrive,
  Menu,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GlobalSearchModal } from "@/components/search/global-search-modal";
import { useState, useEffect } from "react";

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/files": "My Files",
  "/recent": "Recent Files",
  "/starred": "Starred",
  "/trash": "Trash",
  "/settings": "Settings",
};

interface HeaderProps {
  onMobileMenuToggle?: () => void;
}

export function Header({ onMobileMenuToggle }: HeaderProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Global hotkey: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const title = routeTitles[pathname] || "My Files";

  return (
    <header className="h-16 border-b border-border bg-card/80 backdrop-blur-sm px-4 lg:px-6 flex items-center justify-between sticky top-0 z-30">
      {/* Left: Mobile hamburger & Breadcrumb */}
      <div className="flex items-center gap-3">
        {onMobileMenuToggle && (
          <button
            onClick={onMobileMenuToggle}
            className="md:hidden p-2 rounded-lg hover:bg-muted text-foreground"
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">Drive</span>
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="font-semibold text-foreground truncate max-w-[180px] sm:max-w-xs">
            {title}
          </span>
        </nav>
      </div>

      {/* Center: Search Bar Trigger */}
      <div className="hidden md:flex items-center flex-1 max-w-md mx-6">
        <button
          onClick={() => setSearchOpen(true)}
          className="relative w-full h-9 pl-9 pr-12 rounded-xl border border-input bg-background/60 hover:bg-background text-sm text-muted-foreground flex items-center justify-between transition-all cursor-pointer shadow-2xs"
        >
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <span>Search files, extensions, folders...</span>
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground bg-muted border border-border rounded">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Actions, Theme Toggle, User Avatar */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Storage status pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Local Storage Active</span>
        </div>

        {/* Theme switcher */}
        <ThemeToggle />

        {/* User profile dropdown */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 p-1 pl-2 rounded-full border border-border bg-card hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
          >
            <span className="text-xs font-medium max-w-[100px] truncate hidden sm:inline">
              {session?.user?.name || "Owner"}
            </span>
            <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
              {session?.user?.name ? session.user.name.charAt(0).toUpperCase() : "O"}
            </div>
          </button>

          {userMenuOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setUserMenuOpen(false)}
              />

              {/* Dropdown Menu */}
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card text-card-foreground shadow-lg py-2 z-50 animate-in fade-in-0 zoom-in-95">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-sm font-semibold truncate">{session?.user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{session?.user?.email}</p>
                </div>

                <div className="py-1">
                  <Link
                    href="/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <HardDrive className="w-4 h-4 text-muted-foreground" />
                    <span>Storage Settings</span>
                  </Link>
                </div>

                <div className="border-t border-border pt-1">
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
