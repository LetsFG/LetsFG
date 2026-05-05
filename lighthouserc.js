/** @type {import('@lhci/utils/src/types').LHCIConfig} */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/en/flights/gdn-bcn/',
        'http://localhost:3000/en/flights/lhr-jfk/',
      ],
      numberOfRuns: 3,
      startServerCommand: 'cd website && npm start',
      startServerReadyPattern: 'ready on',
    },
    assert: {
      assertions: {
        // Core Web Vitals
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],      // LCP < 2.0s
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],        // CLS < 0.1
        'first-contentful-paint': ['error', { maxNumericValue: 1500 }],        // FCP < 1.5s
        // JavaScript bundle size
        'total-byte-weight': ['warn', { maxNumericValue: 153600 }],            // JS < 150KB (150 * 1024)
        // Accessibility & SEO
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        // Performance category
        'categories:performance': ['warn', { minScore: 0.8 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
}
