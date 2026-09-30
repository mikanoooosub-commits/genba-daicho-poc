import { AppHeader } from "@/components/app-header";
import { SchoolManager } from "@/components/schools/school-manager";
import { getSchools } from "@/lib/data/queries";

export const dynamic = "force-dynamic";

export default async function SchoolsPage() {
  const schools = await getSchools();

  return (
    <>
      <AppHeader title="小学校マスタ" subtitle="対象小学校の管理" />
      <main className="px-4 py-4">
        <SchoolManager schools={schools} />
      </main>
    </>
  );
}
