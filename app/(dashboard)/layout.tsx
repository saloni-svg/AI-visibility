import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { currentProfile } from "@/lib/users";
import AppHeader from "../components/AppHeader";

// Hosted (e.g. Vercel): let page requests and server actions run up to 5 minutes. Agent steps,
// Keyword Planner lookups and AI checks can take a few minutes.
export const maxDuration = 300;

// Every dashboard page: navigation on the left, domain box and account on top.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const profile = await currentProfile(); // null until the 0015 migration has run
  return (
    <div className="app-top">
      <AppHeader email={user.email ?? "your account"} name={profile?.full_name} role={profile?.role}>{children}</AppHeader>
    </div>
  );
}
