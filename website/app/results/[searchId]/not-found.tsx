export default function NotFound() {
  return (
    <main className="main">
      <div className="expired-container" style={{ minHeight: '100vh' }}>
        <h2 className="expired-title">Search not found</h2>
        <p className="expired-subtitle">
          This search doesn't exist or has expired.
        </p>
        <a href="/" className="btn-primary">
          Start a new search →
        </a>
      </div>
    </main>
  )
}
