import Icon from "../components/Icon";

// Sign-in and sign-up share this split screen: a brand panel and the form.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="brand-lockup brand-lockup-light">
          <span className="logo-mark"><Icon name="logo" size={18} /></span>
          <div>
            <div className="brand-name">AI Visibility</div>
            <div className="brand-tag">Brand monitor</div>
          </div>
        </div>

        <div className="auth-pitch">
          <h2>Know when AI recommends you.</h2>
          <p>Track how ChatGPT, Gemini and Perplexity talk about your brand and your competitors.</p>
          <ul>
            {[
              "Mention rate across every AI tool",
              "Your position against competitors",
              "The websites AI trusts as sources",
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
