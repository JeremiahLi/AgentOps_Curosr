import { AppSidebar } from "@/components/shell/app-sidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-aurora">
      <AppSidebar />
      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
    </div>
  );
}
