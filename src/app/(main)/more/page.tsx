import Link from "next/link";
import { Briefcase, ChevronRight, Settings } from "lucide-react";

// スマホの下ナビの「その他」(D104-7)。発注元と事業者情報へ行く入口だけの画面。
// PC では左のメニューに同じ項目があるので、この画面は主にスマホで使う。
export const metadata = { title: "その他 | 現場台帳" };

const LINKS = [
  { href: "/clients", label: "発注元", sub: "管理会社・FC本部などを登録・編集します", icon: Briefcase },
  { href: "/settings/business-profile", label: "事業者情報", sub: "見積書に載せる屋号・住所・お振込先を設定します", icon: Settings },
] as const;

export default function MorePage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>その他</h1>
          <p className="sub">発注元と事業者情報の設定です。</p>
        </div>
      </div>
      <ul className="card more-list">
        {LINKS.map(({ href, label, sub, icon: Icon }) => (
          <li key={href}>
            <Link href={href}>
              <Icon className="icon" aria-hidden="true" />
              <span className="txt">
                <strong>{label}</strong>
                <span className="caption">{sub}</span>
              </span>
              <ChevronRight className="icon go" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
