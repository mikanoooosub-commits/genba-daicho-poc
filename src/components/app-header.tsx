import Link from "next/link";
import { ChevronLeft, MapPin } from "lucide-react";

import { AccountMenu } from "@/components/account-menu";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  /** 右側に表示する要素。省略時はログアウトメニュー。null を渡すと非表示。 */
  action?: React.ReactNode | null;
};

export function AppHeader({ title, subtitle, backHref, action }: Props) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-3.5 md:max-w-3xl">
        {backHref ? (
          <Link
            href={backHref}
            className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary"
            aria-label="戻る"
          >
            <ChevronLeft className="size-5" />
          </Link>
        ) : (
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-primary">
            <MapPin className="size-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-extrabold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action === undefined ? <AccountMenu /> : action}
      </div>
    </header>
  );
}
