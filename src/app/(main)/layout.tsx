import { AppNav } from "@/components/app-nav";

export default function MainLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="app">
      <AppNav />
      <main className="main">
        <div className="main-inner">{children}</div>
      </main>
    </div>
  );
}
