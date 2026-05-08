export default function MonitorSuccessLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Override the dark site background so the redirect is invisible */}
      <style>{`body { background: #fff !important; }`}</style>
      {children}
    </>
  )
}
