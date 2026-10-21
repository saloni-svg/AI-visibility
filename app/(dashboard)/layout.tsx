import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AppHeader from "../components/AppHeader";

// Every dashboard page: navigation on the left, domain box and account on top.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="app-top">
      <AppHeader email={user.email ?? "your account"}>{children}</AppHeader>
    </div>
  );
}
