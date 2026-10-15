import AuthForm from "../../components/AuthForm";

export const metadata = { title: "Sign in · AI Visibility" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <AuthForm mode="signin" next={next} initialError={error} />;
}
