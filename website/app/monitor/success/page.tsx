import Link from 'next/link'

export const metadata = {
  title: 'Monitoring active — LetsFG',
  robots: { index: false },
}

export default function MonitorSuccessPage() {
  return (
    <main className="mon-redirect-page">
      <div className="mon-redirect-card mon-redirect-card--success">
        <div className="mon-redirect-icon" aria-hidden="true">✅</div>
        <h1 className="mon-redirect-title">Your monitoring is active!</h1>
        <p className="mon-redirect-body">
          Check your email for a confirmation with your first daily update. You&apos;ll get
          price alerts and one booking unlock per week for the route you selected.
        </p>
        <Link href="/en" className="mon-redirect-btn">
          Search more flights
        </Link>
      </div>
    </main>
  )
}
