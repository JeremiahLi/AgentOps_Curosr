import { AppSidebar } from "@/components/shell/app-sidebar";
import { AppTopbar } from "@/components/shell/app-topbar";
import { ProcessAnomalyProvider } from "@/components/shell/process-anomaly";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProcessAnomalyProvider>
      <div className="flex h-screen overflow-hidden bg-aurora">
        <AppSidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <AppTopbar />
          <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
        </div>
      </div>
    </ProcessAnomalyProvider>
  );
}
