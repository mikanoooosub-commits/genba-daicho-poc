import { redirect } from "next/navigation";

// 入口は案件の一覧(D75・D80・WO-011 段階2)。
export default function HomePage() {
  redirect("/cases");
}
