// Shown instantly while a dashboard page loads (on the live site too): a "Loading…" pill in the
// bottom-left corner and a placeholder of the page, so a click never looks like nothing happened.
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
      <div className="load-pill" role="status">
        <span className="load-spin" aria-hidden="true" />
        Loading…
      </div>
    </>
  );
}
