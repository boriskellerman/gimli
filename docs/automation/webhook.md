---
summary: "Webhook ingress for wake and isolated agent runs"
read_when:
  - Adding or changing webhook endpoints
  - Wiring external systems into Gimli
---

# Webhooks

Gateway can expose a small HTTP webhook endpoint for external triggers.

## Enable

```json5
{
  hooks: {
    enabled: true,
    token: "shared-secret",
    path: "/hooks"
  }
}
```

Notes:
- `hooks.token` is required when `hooks.enabled=true`.
- `hooks.path` defaults to `/hooks`.

## Auth

Every request must include the hook token. Prefer headers:
- `Authorization: Bearer <token>` (recommended)
- `x-gimli-token: <token>`
- `?token=<token>` (deprecated; logs a warning and will be removed in a future major release)

## Endpoints

### `POST /hooks/wake`

Payload:
```json
{ "text": "System line", "mode": "now" }
```

- `text` **required** (string): The description of the event (e.g., "New email received").
- `mode` optional (`now` | `next-heartbeat`): Whether to trigger an immediate heartbeat (default `now`) or wait for the next periodic check.

Effect:
- Enqueues a system event for the **main** session
- If `mode=now`, triggers an immediate heartbeat

### `POST /hooks/agent`

Payload:
```json
{
  "message": "Run this",
  "name": "Email",
  "sessionKey": "hook:email:msg-123",
  "wakeMode": "now",
  "deliver": true,
  "channel": "last",
  "to": "+15551234567",
  "model": "openai/gpt-5.2-mini",
  "thinking": "low",
  "timeoutSeconds": 120
}
```

- `message` **required** (string): The prompt or message for the agent to process.
- `name` optional (string): Human-readable name for the hook (e.g., "GitHub"), used as a prefix in session summaries.
- `sessionKey` optional (string): The key used to identify the agent's session. Defaults to a random `hook:<uuid>`. Using a consistent key allows for a multi-turn conversation within the hook context.
- `wakeMode` optional (`now` | `next-heartbeat`): Whether to trigger an immediate heartbeat (default `now`) or wait for the next periodic check.
- `deliver` optional (boolean): If `true`, the agent's response will be sent to the messaging channel. Defaults to `true`. Responses that are only heartbeat acknowledgments are automatically skipped.
- `channel` optional (string): The messaging channel for delivery. One of: `last`, `whatsapp`, `telegram`, `discord`, `slack`, `mattermost` (plugin), `signal`, `imessage`, `msteams`. Defaults to `last`.
- `to` optional (string): The recipient identifier for the channel (e.g., phone number for WhatsApp/Signal, chat ID for Telegram, channel ID for Discord/Slack/Mattermost (plugin), conversation ID for MS Teams). Defaults to the last recipient in the main session.
- `model` optional (string): Model override (e.g., `anthropic/claude-3-5-sonnet` or an alias). Must be in the allowed model list if restricted.
- `thinking` optional (string): Thinking level override (e.g., `low`, `medium`, `high`).
- `timeoutSeconds` optional (number): Maximum duration for the agent run in seconds.

Effect:
- Runs an **isolated** agent turn (own session key)
- Always posts a summary into the **main** session
- If `wakeMode=now`, triggers an immediate heartbeat

### `POST /hooks/<name>` (mapped)

Custom hook names are resolved via `hooks.mappings` (see configuration). A mapping can
turn arbitrary payloads into `wake` or `agent` actions, with optional templates or
code transforms.

Mapping options (summary):
- `hooks.presets: ["gmail"]` enables the built-in Gmail mapping.
- `hooks.mappings` lets you define `match`, `action`, and templates in config.
- `hooks.transformsDir` + `transform.module` loads a JS/TS module for custom logic.
- Use `match.source` to keep a generic ingest endpoint (payload-driven routing).
- TS transforms require a TS loader (e.g. `bun` or `tsx`) or precompiled `.js` at runtime.
- Set `deliver: true` + `channel`/`to` on mappings to route replies to a chat surface
  (`channel` defaults to `last` and falls back to WhatsApp).
- `allowUnsafeExternalContent: true` disables the external content safety wrapper for that hook
  (dangerous; only for trusted internal sources).
- `gimli webhooks gmail setup` writes `hooks.gmail` config for `gimli webhooks gmail run`.
See [Gmail Pub/Sub](/automation/gmail-pubsub) for the full Gmail watch flow.

### `POST /hooks/workflow`

Trigger a multi-step AI Developer Workflow (ADW). Workflows run steps sequentially
with optional conditions based on previous step results.

Payload:
```json
{
  "id": "plan-build-test",
  "name": "Plan-Build-Test",
  "sessionKey": "workflow:my-task",
  "deliver": false,
  "model": "anthropic/claude-3-5-sonnet",
  "thinking": "high",
  "continueOnError": false,
  "steps": [
    {"id": "plan", "name": "Plan", "message": "Create implementation plan"},
    {"id": "build", "name": "Build", "message": "Implement the plan", "condition": "previous-success"},
    {"id": "test", "name": "Test", "message": "Run tests", "condition": "previous-success"}
  ]
}
```

Step conditions:
- `always` (default): Step always runs
- `previous-success`: Step runs only if previous step succeeded
- `previous-error`: Step runs only if previous step failed

Effect:
- Returns a `workflowRunId` immediately (202)
- Steps execute sequentially in the background
- Each step runs as an isolated agent turn
- Results available via `GET /hooks/workflows/:workflowRunId`

### `GET /hooks/runs`

List recent hook agent runs with optional filtering.

Query parameters:
- `status` (optional): Filter by status (`pending`, `running`, `completed`, `error`)
- `name` (optional): Filter by hook name (case-insensitive substring match)
- `limit` (optional): Max results (1-100, default 50)
- `offset` (optional): Pagination offset (default 0)

```bash
curl 'http://127.0.0.1:18789/hooks/runs?status=completed&limit=10' \
  -H 'Authorization: Bearer SECRET'
```

### `GET /hooks/runs/stats`

Get run statistics showing counts by status.

```bash
curl http://127.0.0.1:18789/hooks/runs/stats \
  -H 'Authorization: Bearer SECRET'
```

Returns:
```json
{"ok":true,"stats":{"total":15,"pending":1,"running":2,"completed":10,"error":2}}
```

### `GET /hooks/runs/:runId`

Get the status and result of a specific agent run.

```bash
curl http://127.0.0.1:18789/hooks/runs/abc-123 \
  -H 'Authorization: Bearer SECRET'
```

Returns:
```json
{
  "ok": true,
  "run": {
    "runId": "abc-123",
    "name": "GitHub",
    "sessionKey": "hook:github:issue-42",
    "status": "completed",
    "createdAt": 1706832000000,
    "startedAt": 1706832001000,
    "completedAt": 1706832010000,
    "summary": "Issue triaged and labeled",
    "outputText": "I reviewed the issue and..."
  }
}
```

### `GET /hooks/workflows`

List recent workflow runs with optional filtering.

Query parameters:
- `status` (optional): Filter by status (`pending`, `running`, `completed`, `error`)
- `workflowId` (optional): Filter by workflow ID
- `limit` (optional): Max results (1-100, default 50)
- `offset` (optional): Pagination offset (default 0)

### `GET /hooks/workflows/:workflowRunId`

Get the status and step results of a specific workflow run.

```bash
curl http://127.0.0.1:18789/hooks/workflows/wf-1706832000-abc123 \
  -H 'Authorization: Bearer SECRET'
```

## Responses

- `200` for `/hooks/wake`, GET endpoints
- `202` for `/hooks/agent`, `/hooks/workflow` (async run started)
- `401` on auth failure
- `400` on invalid payload
- `404` for unknown run/workflow IDs
- `413` on oversized payloads

## Examples

```bash
curl -X POST http://127.0.0.1:18789/hooks/wake \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"text":"New email received","mode":"now"}'
```

```bash
curl -X POST http://127.0.0.1:18789/hooks/agent \
  -H 'x-gimli-token: SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize inbox","name":"Email","wakeMode":"next-heartbeat"}'
```

### Use a different model

Add `model` to the agent payload (or mapping) to override the model for that run:

```bash
curl -X POST http://127.0.0.1:18789/hooks/agent \
  -H 'x-gimli-token: SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"message":"Summarize inbox","name":"Email","model":"openai/gpt-5.2-mini"}'
```

If you enforce `agents.defaults.models`, make sure the override model is included there.

```bash
curl -X POST http://127.0.0.1:18789/hooks/gmail \
  -H 'Authorization: Bearer SECRET' \
  -H 'Content-Type: application/json' \
  -d '{"source":"gmail","messages":[{"from":"Ada","subject":"Hello","snippet":"Hi"}]}'
```

## Security

- Keep hook endpoints behind loopback, tailnet, or trusted reverse proxy.
- Use a dedicated hook token; do not reuse gateway auth tokens.
- Avoid including sensitive raw payloads in webhook logs.
- Hook payloads are treated as untrusted and wrapped with safety boundaries by default.
  If you must disable this for a specific hook, set `allowUnsafeExternalContent: true`
  in that hook's mapping (dangerous).
