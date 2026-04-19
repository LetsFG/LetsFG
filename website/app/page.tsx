import { redirect } from 'next/navigation'

// Middleware handles the redirect for most clients.
// This is a safety-net for any direct hits to /.
export default function RootPage() {
  redirect('/en')
}

