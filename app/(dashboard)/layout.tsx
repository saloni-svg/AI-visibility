import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import Sidebar from "../components/Sidebar";

// Every dashboard page gets the side panel on the left.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="app-shell">
      <Sidebar email={user.email ?? "your account"} />
      <div className="app-content">{children}</div>
    </div>
  );
}
