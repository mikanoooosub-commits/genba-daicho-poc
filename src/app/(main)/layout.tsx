import { BottomTabBar } from "@/components/bottom-tab-bar";
import { DemoBanner } from "@/components/demo-banner";
import { isDemoMode } from "@/lib/supabase/server";

export default async function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demo = await isDemoMode();

  return (
    <div className="mx-auto min-h-dvh max-w-md pb-20 md:max-w-3xl">
      {demo && <DemoBanner />}
      {children}
      <BottomTabBar />
    </div>
  );
}
