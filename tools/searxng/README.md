# Local SearXNG diagnostics

ContentGen runs the official SearXNG image on a randomly assigned **loopback-only** port. Startup output can include warnings that do not by themselves mean the service failed.

| Container log | Interpretation |
| --- | --- |
| `ahmia` / `torch: can't register engine` | Optional search engines failed to load in this image. General web engines can still work. These are not prerequisites for ContentGen. |
| `missing config file: /etc/searxng/limiter.toml` | The optional bot limiter config is absent. ContentGen has `server.limiter: false` and is not configured as a public SearXNG instance. |
| `X-Forwarded-For nor X-Real-IP header is set` | Bot-detection logic did not receive proxy IP headers. ContentGen connects directly to a loopback port rather than through a public reverse proxy. |

## What to check

From the repository root:

```sh
pnpm --dir apps/web research:status
pnpm --dir apps/web research:check
```

`research:status` checks the configured local web server. `research:check` explicitly performs a real SearXNG JSON search. A healthy root page is **not** enough to establish that engines and JSON results work.

If `research:check` fails, inspect the failure message and service logs before changing engine or proxy configuration. Do not add forwarded-IP headers merely to quiet a log line, and do not expose the local instance on a public interface.

The Studio Research page performs a read-only root reachability check at load time, not a public search. It never starts Docker automatically.
