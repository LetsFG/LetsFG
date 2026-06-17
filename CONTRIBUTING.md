# Contributing to LetsFG

Thanks for your interest in contributing! 🚀

## Quick Links

- **GitHub:** https://github.com/LetsFG/LetsFG
- **API Docs:** https://letsfg.co/developers/api/docs
- **npm (JS SDK):** https://www.npmjs.com/package/letsfg
- **npm (MCP):** https://www.npmjs.com/package/letsfg-mcp
- **PyPI:** https://pypi.org/project/letsfg/

## How to Contribute

1. **Bugs & small fixes** → Open a PR directly
2. **New features / architecture changes** → Open a [GitHub Issue](https://github.com/LetsFG/LetsFG/issues) first to discuss
3. **Questions** → Open a [GitHub Discussion](https://github.com/LetsFG/LetsFG/discussions)

## Before You PR

- Test locally and run the relevant SDK tests (see [docs/TESTING.md](docs/TESTING.md) for the full testing guide)
- Keep PRs focused — one thing per PR
- Describe **what** you changed and **why**

## Testing & Definition of Done

**Every PR that adds or modifies behavior must include tests.** No exceptions.

See **[docs/TESTING.md](docs/TESTING.md)** for the complete guide, including:
- The three-tier test taxonomy (Tier-1 deterministic → Tier-2 live smoke → Tier-3 prod synthetic)
- How to add a connector parsing test and fixture
- How to register a Tier-2 test route
- The Red-Green-Refactor mandate

### Quick reference

```bash
# Tier-1 — must be green before merge
cd website && npm run test:critical        # website critical-path
cd sdk/python && pytest tests/ -m "not live"  # connector parsing

# Tier-2 — live smoke for changed connectors (non-blocking)
python connectors/tests/smoke_harness.py ryanair_direct
```

## Development Setup

### Python SDK

```bash
cd sdk/python
pip install -e ".[dev]"
python -m pytest
```

### JS/TS SDK

```bash
cd sdk/js
npm install
npm run build
npm test
```

### MCP Server

```bash
cd sdk/mcp
npm install
npm run build
```

## Repository Structure

```
sdk/
├── python/    # Python SDK (PyPI: letsfg)
├── js/        # JavaScript/TypeScript SDK (npm: letsfg)
└── mcp/       # MCP Server (npm: letsfg-mcp)
```

The backend API is in a separate private repository. This repo contains the public SDKs, MCP server, and documentation only.

## Code Style

### Python
- Type hints everywhere
- `httpx` for HTTP requests
- `pydantic` for data models
- Follow existing patterns in `client.py`

### TypeScript
- Strict mode enabled
- Native `fetch` (no axios/got)
- Export types from `types.ts`
- Rebuild dist after changes: `npm run build`

## Commit Messages

Use concise, action-oriented messages:

```
fix: handle timeout in Python search client
feat: add returnUrl option to JS unlock method
docs: update MCP server README with new tool descriptions
```

## AI-Assisted PRs Welcome! 🤖

Built with Copilot, Claude, Cursor, or other AI tools? Great — just note it in your PR description so I know what to look for when reviewing.

## Important: Keep Messaging Consistent

When editing any agent-facing text (READMEs, SDK docstrings, MCP tool descriptions), please maintain:

1. **Zero price bias** messaging — this is a core differentiator
2. **Real passenger details** warning — critical for bookings
3. **Pricing accuracy** — search is free via Bearer token; unlock costs 1% of ticket (min $3)

## Report a Vulnerability

See [SECURITY.md](SECURITY.md) for our security policy and how to report vulnerabilities.

## License

MIT — see [LICENSE](LICENSE).
