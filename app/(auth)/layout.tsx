import BrandLockup from "../components/BrandMark";
import Icon from "../components/Icon";

// Sign-in and sign-up share this split screen: a brand panel and the form.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <BrandLockup tag="by DigitalRyze" />

        <div className="auth-pitch">
          <h2>Rise in Google and in AI answers.</h2>
          <p>RyzeIQ tracks your rankings, Search Console data and how ChatGPT, Gemini and Perplexity talk about your brand, then tells you what to do next.</p>
          <ul>
            {[
              "Google rankings, search volume and CPC",
              "AI visibility against your competitors",
              "AI agents that write your SEO plan",
            ].map((item) => (
              <li key={item}>
                <span className="check"><Icon name="check" size={14} /></span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Decorative preview of the dashboard. */}
        <div className="auth-preview" aria-hidden="true">
          <div className="preview-label">Mentioned in</div>
          <div className="preview-value">40%</div>
          <div className="preview-bars">
            <span style={{ width: "84%", background: "var(--openai)" }} />
            <span style={{ width: "66%", background: "var(--gemini)" }} />
            <span style={{ width: "88%", background: "var(--perplexity)" }} />
          </div>
        </div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}
