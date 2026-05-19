import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_SERVER_PATH = '/developers/api/v1'

function resolveOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.split(',')[0]?.trim()

  if (forwardedHost) {
    return `${forwardedProto || 'https'}://${forwardedHost}`
  }

  return process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin
}

function buildPublicSpec(origin: string) {
  const developerApiServer = `${origin}${PUBLIC_SERVER_PATH}`
  const docsUrl = `${origin}/developers/api/docs`
  const openApiUrl = `${origin}/developers/api/openapi.json`

  return {
    openapi: '3.1.0',
    info: {
      title: 'LetsFG Public Developer API',
      version: '1.0.0',
      summary: 'Public developer API served from letsfg.co for onboarding, billing, and flight search.',
      description:
        'Canonical public developer base: https://letsfg.co/developers/api/v1. Browserless agents can register, attach a Stripe payment_method_id or token, top up prepaid balance, and search without direct backend access. Hosted checkout remains available for browser-based onboarding.',
    },
    servers: [
      {
        url: developerApiServer,
        description: 'Public letsfg.co developer API',
      },
    ],
    externalDocs: {
      description: 'Interactive Swagger docs',
      url: docsUrl,
    },
    tags: [
      {
        name: 'agents',
        description:
          'Public developer onboarding and account operations. Register first, attach Stripe payment, top up balance, then search.',
      },
      {
        name: 'flights',
        description:
          'Public developer flight search. Requests require an API key and consume prepaid developer balance.',
      },
    ],
    security: [{ DeveloperApiKey: [] }],
    components: {
      securitySchemes: {
        DeveloperApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Developer API key returned by POST /agents/register.',
        },
      },
      schemas: {
        AgentRegistrationRequest: {
          type: 'object',
          required: ['agent_name'],
          properties: {
            agent_name: { type: 'string', minLength: 2, maxLength: 100 },
            email: { type: 'string', format: 'email' },
            owner_name: { type: 'string' },
            description: { type: 'string' },
          },
          example: {
            agent_name: 'my-agent',
            email: 'you@example.com',
            owner_name: 'My Team',
          },
        },
        AgentRegistrationResponse: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            api_key: { type: 'string' },
            stripe_customer_id: { type: 'string' },
            payment_ready: { type: 'boolean' },
            tier: { type: 'string' },
            message: { type: 'string' },
          },
        },
        HostedCheckoutRequest: {
          type: 'object',
          required: ['success_url', 'cancel_url'],
          properties: {
            success_url: { type: 'string', format: 'uri' },
            cancel_url: { type: 'string', format: 'uri' },
          },
        },
        HostedCheckoutCompleteRequest: {
          type: 'object',
          required: ['session_id'],
          properties: {
            session_id: { type: 'string' },
            api_key: { type: 'string' },
          },
        },
        CheckoutStatusResponse: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checkout_url: { type: 'string', format: 'uri' },
            session_id: { type: 'string' },
            api_key: { type: 'string' },
            payment_ready: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        AgentSetupPaymentRequest: {
          type: 'object',
          description:
            'Public letsfg.co setup-payment accepts only Stripe-generated payment_method_id or token fields. Raw card details and browser checkout URLs are not part of the public contract.',
          properties: {
            payment_method_id: {
              type: 'string',
              description: 'Stripe PaymentMethod ID (pm_xxx)',
            },
            token: {
              type: 'string',
              description: 'Stripe token (tok_visa, tok_mastercard, or Stripe.js token)',
            },
          },
          example: {
            payment_method_id: 'pm_123',
          },
        },
        PaymentReadyResponse: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            payment_method_id: { type: 'string' },
            message: { type: 'string' },
          },
        },
        BillingPortalRequest: {
          type: 'object',
          required: ['return_url'],
          properties: {
            return_url: { type: 'string', format: 'uri' },
          },
        },
        BillingPortalResponse: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            portal_url: { type: 'string', format: 'uri' },
            session_id: { type: 'string' },
            message: { type: 'string' },
          },
        },
        AgentTopUpRequest: {
          type: 'object',
          required: ['amount_cents'],
          properties: {
            amount_cents: { type: 'integer', minimum: 500 },
            auto_refill_enabled: { type: 'boolean', default: false },
            auto_refill_amount_cents: { type: 'integer', minimum: 500 },
          },
          example: {
            amount_cents: 2500,
            auto_refill_enabled: true,
            auto_refill_amount_cents: 2500,
          },
        },
        AgentBillingSettingsRequest: {
          type: 'object',
          required: ['auto_refill_enabled'],
          properties: {
            auto_refill_enabled: { type: 'boolean' },
            auto_refill_amount_cents: { type: 'integer', minimum: 500 },
          },
        },
        AgentProfileResponse: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            agent_name: { type: 'string' },
            email: { type: 'string' },
            payment_ready: { type: 'boolean' },
            github_username: { type: 'string' },
            github_star_verified: { type: 'boolean' },
            access_granted: { type: 'boolean' },
            developer_api: {
              type: 'object',
              properties: {
                api_access_enabled: { type: 'boolean' },
                billing_plan: { type: 'string' },
                price_per_search_cents: { type: 'integer' },
                minimum_top_up_cents: { type: 'integer' },
                balance_cents: { type: 'integer' },
                billing_currency: { type: 'string' },
                auto_refill_enabled: { type: 'boolean' },
                auto_refill_amount_cents: { type: 'integer' },
              },
            },
            usage: {
              type: 'object',
              properties: {
                total_requests: { type: 'integer' },
                total_searches: { type: 'integer' },
                total_unlocks: { type: 'integer' },
                total_bookings: { type: 'integer' },
                total_spent_cents: { type: 'integer' },
              },
            },
          },
        },
        FlightSearchRequest: {
          type: 'object',
          required: ['origin', 'destination', 'date_from'],
          properties: {
            origin: { type: 'string', description: 'IATA departure code (e.g. LON, JFK)' },
            destination: { type: 'string', description: 'IATA arrival code (e.g. BCN, LAX)' },
            date_from: { type: 'string', format: 'date' },
            date_to: { type: 'string', format: 'date' },
            return_from: { type: 'string', format: 'date' },
            return_to: { type: 'string', format: 'date' },
            adults: { type: 'integer', minimum: 1, maximum: 9, default: 1 },
            children: { type: 'integer', minimum: 0, maximum: 9, default: 0 },
            infants: { type: 'integer', minimum: 0, maximum: 9, default: 0 },
            cabin_class: { type: 'string', enum: ['M', 'W', 'C', 'F'] },
            max_stopovers: { type: 'integer', minimum: 0, maximum: 4, default: 2 },
            currency: { type: 'string', minLength: 3, maxLength: 3, default: 'EUR' },
            locale: { type: 'string', default: 'en' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            sort: { type: 'string', default: 'price' },
            departure_time_from: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
            departure_time_to: { type: 'string', pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' },
            provider_filters: { type: 'object', additionalProperties: true },
          },
          example: {
            origin: 'LON',
            destination: 'BCN',
            date_from: '2026-06-15',
            adults: 1,
            currency: 'EUR',
          },
        },
        FlightSearchResponse: {
          type: 'object',
          properties: {
            passenger_ids: { type: 'array', items: { type: 'string' } },
            total_results: { type: 'integer' },
            offers: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
              },
            },
          },
        },
        FlightsProvidersResponse: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            detail: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    paths: {
      '/agents/register': {
        post: {
          tags: ['agents'],
          summary: 'Register a developer account and issue an API key',
          description:
            'Create a developer account over the public letsfg.co API. The returned API key is used on all authenticated public API routes.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentRegistrationRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Developer account registered.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AgentRegistrationResponse' },
                },
              },
            },
          },
        },
      },
      '/agents/hosted-checkout': {
        post: {
          tags: ['agents'],
          summary: 'Start hosted Stripe checkout',
          description: 'Create the browser-based Stripe onboarding session for developers who have a browser available.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HostedCheckoutRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Hosted checkout session created.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CheckoutStatusResponse' },
                },
              },
            },
          },
        },
      },
      '/agents/hosted-checkout/complete': {
        post: {
          tags: ['agents'],
          summary: 'Finalize hosted checkout',
          description: 'Turn a completed hosted checkout session into a ready developer account.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HostedCheckoutCompleteRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Hosted checkout completed and account is ready.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CheckoutStatusResponse' },
                },
              },
            },
          },
        },
      },
      '/agents/setup-payment': {
        post: {
          tags: ['agents'],
          summary: 'Attach a Stripe payment method for API-only onboarding',
          description:
            'Public letsfg.co setup-payment accepts only Stripe-generated payment_method_id or token values. Raw card details and browser checkout fields are intentionally rejected on the public proxy.',
          security: [{ DeveloperApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentSetupPaymentRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Stripe payment method attached.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PaymentReadyResponse' },
                },
              },
            },
            '400': {
              description: 'Unsupported public payment payload.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/agents/billing-portal': {
        post: {
          tags: ['agents'],
          summary: 'Open Stripe billing portal',
          security: [{ DeveloperApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/BillingPortalRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Stripe billing portal session created.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BillingPortalResponse' },
                },
              },
            },
          },
        },
      },
      '/agents/me': {
        get: {
          tags: ['agents'],
          summary: 'Get developer account profile',
          security: [{ DeveloperApiKey: [] }],
          responses: {
            '200': {
              description: 'Developer account profile, usage, and balance state.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AgentProfileResponse' },
                },
              },
            },
          },
        },
      },
      '/agents/top-up': {
        post: {
          tags: ['agents'],
          summary: 'Fund prepaid developer balance',
          description: 'Charge the saved Stripe payment method and fund prepaid developer balance. Public flight search consumes this balance.',
          security: [{ DeveloperApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentTopUpRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Prepaid balance funded.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      '/agents/billing-settings': {
        post: {
          tags: ['agents'],
          summary: 'Update billing settings',
          security: [{ DeveloperApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AgentBillingSettingsRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Billing settings updated.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
      },
      '/agents/rotate-key': {
        post: {
          tags: ['agents'],
          summary: 'Rotate developer API key',
          security: [{ DeveloperApiKey: [] }],
          responses: {
            '200': {
              description: 'Developer API key rotated.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      agent_id: { type: 'string' },
                      api_key: { type: 'string' },
                      rotated_at: { type: 'string' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/flights/search': {
        post: {
          tags: ['flights'],
          summary: 'Search flights through the public developer API',
          description:
            'Search requires an API key and prepaid developer balance. Requests are sent through letsfg.co/developers/api/v1 and proxied internally to the backend.',
          security: [{ DeveloperApiKey: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FlightSearchRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Flight search results.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FlightSearchResponse' },
                },
              },
            },
          },
        },
      },
      '/flights/locations/{query}': {
        get: {
          tags: ['flights'],
          summary: 'Resolve a location to IATA codes',
          security: [{ DeveloperApiKey: [] }],
          parameters: [
            {
              name: 'query',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'City, airport, or IATA query string.',
            },
          ],
          responses: {
            '200': {
              description: 'Matching cities and airports.',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/flights/providers': {
        get: {
          tags: ['flights'],
          summary: 'List flight providers visible to the public API',
          security: [{ DeveloperApiKey: [] }],
          responses: {
            '200': {
              description: 'Provider status list.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/FlightsProvidersResponse' },
                },
              },
            },
          },
        },
      },
    },
    'x-letsfg-public-docs': {
      root_url: `${origin}/developers/api`,
      openapi_url: openApiUrl,
      swagger_url: docsUrl,
    },
  }
}

export async function GET(request: NextRequest) {
  const spec = buildPublicSpec(resolveOrigin(request))

  return new NextResponse(`${JSON.stringify(spec, null, 2)}\n`, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}