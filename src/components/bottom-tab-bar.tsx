"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map, BookOpen, Building2 } from "lucide-react";

import { cn } from "@/lib/utils";

// P-A″ 現場を軸にした台帳(地図つき): ナビは 地図/台帳/発注元 の3つ(PM決定 D38-2)。
// 既存のチラシ配布向け画面(/list・/schools)はナビから外すが、ルート自体は残す
// (直接URLでアクセスすれば従来どおり動作する。docs/architecture.md参照)。
const TABS = [
  {
    href: "/",
    label: "地図",
    icon: Map,
    match: (p: string) => p === "/" || p.startsWith("/sites"),
  },
  { href: "/ledger", label: "台帳", icon: BookOpen, match: (p: string) => p.startsWith("/ledger") },
  { href: "/clients", label: "発注元", icon: Building2, match: (p: string) => p.startsWith("/clients") },
] as const;

export function BottomTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-md items-stretch justify-around md:max-w-3xl">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-bold transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-5" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
