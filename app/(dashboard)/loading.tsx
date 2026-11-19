// Placeholder of the page while a dashboard page loads. The "Loading…" pill in the bottom-left
// corner comes from NavProgress (in AppHeader), which shows on every link click.
export default function Loading() {
  return (
    <>
      <main className="dash page-loading" aria-busy="true" aria-label="Loading">
        <div className="sk sk-title" />
        <div className="sk sk-line" />
        <div className="sk-row">
          <div className="sk sk-card" />
          <div className="sk sk-card" />
          <div className="sk sk-card" />
          <div className="sk sk-card" />
        </div>
        <div className="sk sk-panel" />
      </main>
    </>
  );
}
