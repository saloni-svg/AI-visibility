import AuthForm from "../../components/AuthForm";

export const metadata = { title: "Sign up · AI Visibility" };

export default function SignupPage() {
  return (
    <main className="auth-page">
      <AuthForm mode="signup" />
    </main>
  );
}
