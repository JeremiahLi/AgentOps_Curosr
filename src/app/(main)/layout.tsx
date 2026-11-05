import { AppSidebar } from "@/components/shell/app-sidebar";
import { PreserveMainScroll } from "@/components/shell/preserve-main-scroll";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-aurora">
      <AppSidebar />
      <PreserveMainScroll>{children}</PreserveMainScroll>
    </div>
  );
}
