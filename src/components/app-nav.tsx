"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, BookOpen, Briefcase, ClipboardList, Ellipsis, Settings } from "lucide-react";

import { AccountMenu } from "@/components/account-menu";

// 画面の骨組みのナビゲーション(docs/DESIGN.md §4.2)。
// PC は左の深緑のメニュー、スマホは上の帯と下のナビゲーション。
// 段階2 の項目は 案件 / 物件 / 台帳(v1) / 発注元。未入金の一覧は段階4 で足す。
// 台帳(v1)は段階4 で作り直すまで使い続ける(D86)。
const ITEMS = [
  { href: "/cases", label: "案件", icon: ClipboardList, match: (p: string) => p.startsWith("/cases") },
  { href: "/buildings", label: "物件", icon: Building2, match: (p: string) => p.startsWith("/buildings") },
  {
    href: "/ledger",
    label: "台帳",
    icon: BookOpen,
    match: (p: string) => p.startsWith("/ledger"),
  },
  { href: "/clients", label: "発注元", icon: Briefcase, match: (p: string) => p.startsWith("/clients") },
  { href: "/settings/business-profile", label: "設定", icon: Settings, match: (p: string) => p.startsWith("/settings") },
] as const;

// スマホの下ナビは4項目(D104-7): 案件・物件・台帳・その他(発注元と事業者情報は「その他」の画面にまとめる)。
// 段階4 で未入金が入ったら、見本・実装・文書を同時に直す。
const MOBILE_ITEMS = [
  ITEMS[0],
  ITEMS[1],
  ITEMS[2],
  {
    href: "/more",
    label: "その他",
    icon: Ellipsis,
    match: (p: string) => p.startsWith("/more") || p.startsWith("/clients") || p.startsWith("/settings"),
  },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <>
      <nav className="sidenav" aria-label="メニュー">
        <div className="brand">
          現場台帳
          <small>研修用の架空データ</small>
        </div>
        {ITEMS.map(({ href, label, icon: Icon, match }) => (
          <Link key={href} href={href} aria-current={match(pathname) ? "page" : undefined}>
            <Icon className="icon" aria-hidden="true" />
            {label}
          </Link>
        ))}
        <div className="sep" role="separator" />
        <div className="account text-white [&_button]:text-white [&_button:hover]:bg-white/10">
          <AccountMenu />
        </div>
      </nav>

      <header className="topbar">
        <span className="brand">現場台帳</span>
        <span className="ml-auto text-white [&_button]:text-white [&_button:hover]:bg-white/10">
          <AccountMenu />
        </span>
      </header>

      <nav className="bottomnav" aria-label="メニュー(スマホ)">
        {MOBILE_ITEMS.map(({ href, label, icon: Icon, match }) => (
          <Link key={href} href={href} aria-current={match(pathname) ? "page" : undefined}>
            <Icon className="icon" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
