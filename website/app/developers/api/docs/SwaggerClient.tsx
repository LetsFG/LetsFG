'use client'

import { useCallback, useEffect } from 'react'
import Script from 'next/script'

declare global {
  interface Window {
    SwaggerUIBundle?: any
    SwaggerUIStandalonePreset?: any
  }
}

type SwaggerClientProps = {
  specUrl: string
}

export default function SwaggerClient({ specUrl }: SwaggerClientProps) {
  const renderSwagger = useCallback(() => {
    if (!window.SwaggerUIBundle) {
      return
    }

    window.SwaggerUIBundle({
      url: specUrl,
      dom_id: '#swagger-ui',
      deepLinking: true,
      docExpansion: 'list',
      persistAuthorization: true,
      presets: [window.SwaggerUIBundle.presets.apis, window.SwaggerUIStandalonePreset].filter(Boolean),
      layout: 'BaseLayout',
    })
  }, [specUrl])

  useEffect(() => {
    renderSwagger()
  }, [renderSwagger])

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      <Script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" strategy="afterInteractive" onLoad={renderSwagger} />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"
        strategy="afterInteractive"
        onLoad={renderSwagger}
      />
      <div id="swagger-ui" />
      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: #f3f0e8;
        }

        .swagger-ui .topbar {
          display: none;
        }

        .swagger-ui {
          font-family: Georgia, 'Times New Roman', serif;
        }
      `}</style>
    </>
  )
}