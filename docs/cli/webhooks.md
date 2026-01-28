---
summary: "CLI reference for `gimli webhooks` (webhook helpers + Gmail Pub/Sub)"
read_when:
  - You want to wire Gmail Pub/Sub events into Gimli
  - You want webhook helper commands
---

# `gimli webhooks`

Webhook helpers and integrations (Gmail Pub/Sub, webhook helpers).

Related:
- Webhooks: [Webhook](/automation/webhook)
- Gmail Pub/Sub: [Gmail Pub/Sub](/automation/gmail-pubsub)

## Gmail

```bash
gimli webhooks gmail setup --account you@example.com
gimli webhooks gmail run
```

See [Gmail Pub/Sub documentation](/automation/gmail-pubsub) for details.
