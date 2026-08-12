# Security Policy

If you believe you've found a security vulnerability in LetsFG, please report it responsibly.

## Reporting a Vulnerability

**Email:** security@letsfg.co

Please include:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Impact assessment** — what can an attacker do?
4. **Affected component** — SDK, API, MCP server, etc.
5. **Your environment** — OS, SDK version, language version

We aim to acknowledge reports within 48 hours and provide a fix or mitigation within 7 days for critical issues.

## Supported Versions

| Package | Version | Supported |
|---------|---------|-----------|
| letsfg (Python) | 1.0.x | ✅ |
| letsfg (npm) | 1.0.x | ✅ |
| letsfg-mcp (npm) | 1.0.x | ✅ |

## Scope

### In Scope

- Authentication/authorization bypasses in the API
- SDK vulnerabilities (injection, credential leakage, etc.)
- MCP server security issues
- Personally identifiable information (PII) exposure
- Payment/billing vulnerabilities

### Out of Scope

- Rate limiting or denial-of-service against the public API
- Social engineering attacks
- Issues in third-party dependencies (report upstream, then let us know)
- Findings from automated scanners without a working proof of concept
- Issues requiring physical access to a user's machine

## Automated Scanning

The repository is scanned for hardcoded credentials and common code
weaknesses on every pull request, on every push to `main`, and once a week.
The workflow is [`.github/workflows/security-scan.yml`](.github/workflows/security-scan.yml).

It is **not** a merge gate. It reports and never fails, at any severity, so a
false positive cannot block a PR. Results appear in the Security tab, and pull
requests get the counts in the job summary.

A finding that is wrong can be marked where it is, naming the rule so the
suppression stays narrow:

```python
bt.setup_payment(token="tok_visa")  # threatcrush-disable-line secret-generic-credential
```

`threatcrush-disable-next-line` and a `.threatcrushignore` of globs at the
repository root work too. Prefer the line comment: it says which rule and
survives the file moving.

## API Security Model

- **API keys** authenticate all requests. Keep your key secret.
- **Stripe** handles all payment processing. LetsFG never stores card numbers.
- **Passenger data** (names, emails) is passed directly to the airline for booking. We do not store passenger PII beyond the booking transaction.
- **HTTPS only** — all API traffic is encrypted in transit.

## Responsible Disclosure

- Please do **not** publicly disclose vulnerabilities before we've had a chance to fix them.
- We will credit reporters in release notes (unless you prefer to remain anonymous).
- There is no bug bounty program at this time. We appreciate responsible disclosure and will acknowledge your contribution.

## Contact

- **Security issues:** security@letsfg.co
- **General questions:** Open a [GitHub Issue](https://github.com/LetsFG/LetsFG/issues)
