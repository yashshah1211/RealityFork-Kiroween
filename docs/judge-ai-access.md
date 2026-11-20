# RealityFork judge AI access

The Hollow, Forking Mirror, built-in examples, and manual planner work on a clean keyless install. In production, the optional AI routes activate only with valid server-side judge configuration. [Local setup](../README.md#run-locally)

## Self-hosting configuration

Use the variable names in [.env.example](../.env.example). Supply values in the server environment of your own HTTPS deployment.

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Enables the optional provider integration when the judge configuration is valid. |
| `GROQ_MODEL` | Selects `openai/gpt-oss-120b` or `openai/gpt-oss-20b`. |
| `RF_JUDGE_INVITE_SHA256` | SHA-256 hex digests of complete private access codes, including their prefix. Separate multiple digests with commas. |
| `RF_JUDGE_SESSION_SECRET` | A separate 32-byte random secret encoded as unpadded base64url. |
| `RF_JUDGE_ORIGIN` | The exact HTTPS origin that serves the app, with no trailing slash. |

Use server-only variables and keep access codes out of source, screenshots and public notes. The hosted demo shares judge codes in the private Devpost testing field. [Judge testing instructions](submission/kiroween-2026/judge-testing.md)

## Testing behavior

Signed sessions expire after up to 24 hours, with a final cutoff of January 30, 2027 at 12:00 UTC. Plan and Revisit share application limits. Each provider attempt, including a validation retry, counts against the allowed budget. The app's counters are process-local, and Groq applies its own limits. A quota error leaves the public examples and manual workflows available. [Groq rate limits](https://console.groq.com/docs/rate-limits)

`npm test` runs the HTTP integration tests with a mocked provider. The Playwright judge, planner, and Revisit journeys use controlled responses. [Test instructions](../README.md#verify)
