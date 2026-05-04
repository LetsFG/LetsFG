import Link from 'next/link'

export const metadata = {
  title: 'Payment cancelled — LetsFG',
  robots: { index: false },
}

export default function MonitorCancelledPage() {
  return (
    <main className="mon-redirect-page">
      <div className="mon-redirect-card mon-redirect-card--cancelled">
        <div className="mon-redirect-icon" aria-hidden="true">↩</div>
        <h1 className="mon-redirect-title">Payment cancelled</h1>
        <p className="mon-redirect-body">
          No problem — your monitoring was not set up and you have not been charged.
          You can try again from the results page any time.
        </p>
        <Link href="/en" className="mon-redirect-btn">
          Back to search
        </Link>
      </div>
    </main>
  )
}
