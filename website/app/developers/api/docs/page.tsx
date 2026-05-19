import SwaggerClient from './SwaggerClient'

export const metadata = {
  title: 'LetsFG Public Developer API Docs',
  description: 'Interactive Swagger UI for the public letsfg.co developer API.',
}

export default function DeveloperApiDocsPage() {
  return <SwaggerClient specUrl="/developers/api/openapi.json" />
}