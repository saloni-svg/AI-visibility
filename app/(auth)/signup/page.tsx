import { redirect } from "next/navigation";

// Sign-up is closed: the owner adds users from Profile → Users.
export default function SignupPage() {
  redirect("/login");
}
