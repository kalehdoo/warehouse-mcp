# Security policy

## Reporting a vulnerability

**Please do not file a public issue for security bugs.** Public disclosure before a fix is published puts every deployment at risk.

To report a vulnerability, use one of:

1. **GitHub Security Advisory** (preferred). Open one privately on this repo: https://github.com/kalehdoo/warehouse-mcp/security/advisories/new
2. **Email** the maintainers privately.

Include in your report:
- A clear description of the issue and what an attacker could achieve
- Reproduction steps or a proof-of-concept (sanitized — no real data)
- Affected versions, if known
- Your name and contact for credit (optional)

We aim to acknowledge reports within 3 business days and ship a fix or mitigation as fast as the severity warrants.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x   | ✓ |
| < 0.1   | (no releases) |

We follow standard semver. Patch releases for security fixes always land on the latest minor of every supported major.

## Scope

In scope:
- The MCP server code in this repo (`src/`, `bin/`)
- The published Docker image (`ghcr.io/kalehdoo/warehouse-mcp`)
- The release pipeline (`.github/workflows/release.yml`) — including image signing and SBOM integrity

Out of scope (deployment-layer concerns documented in [docs/threat-model.md](docs/threat-model.md)):
- TLS termination (your reverse proxy)
- Secrets management (your secrets store)
- Network isolation (your VPC + security groups + NetworkPolicy)
- Warehouse-side authorization beyond what the server passes through

If you find an issue in a transitive npm dependency, please report it upstream first; we'll track it via Dependabot.

## Threat model

Read [docs/threat-model.md](docs/threat-model.md) before deploying. It walks the OWASP Top 10 mapped to warehouse-mcp specifically and documents what the codebase mitigates vs. what is left to the operator.
