import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolveLegalLocale } from '../legal-pages'

export default async function TermsRedirectPage() {
  const cookieStore = await cookies()
  const locale = resolveLegalLocale(
    cookieStore.get('LETSFG_LOCALE')?.value ?? cookieStore.get('NEXT_LOCALE')?.value,
  )

  redirect(`/${locale}/terms`)
}