# Channel Operations

## Purpose
Work with Gimli messaging channels - test connections, debug issues, or analyze message flow.

## Supported Channels
- **telegram**: Telegram bot
- **discord**: Discord bot
- **slack**: Slack app
- **signal**: Signal messenger
- **imessage**: iMessage (macOS only)
- **whatsapp**: WhatsApp Web
- **webchat**: Web chat interface

## Extension Channels
- **msteams**: Microsoft Teams (extensions/msteams)
- **matrix**: Matrix protocol (extensions/matrix)
- **zalo**: Zalo messenger (extensions/zalo)
- **voice-call**: Voice calling (extensions/voice-call)

## Instructions
Based on the channel operation requested:

### List Channels
```bash
gimli channels status --all
```

### Test Channel Connection
```bash
gimli channels status --probe
```

### Channel-Specific Files
- Core channels: `src/telegram/`, `src/discord/`, `src/slack/`, `src/signal/`, `src/imessage/`, `src/web/`
- Extension channels: `extensions/*/`
- Routing: `src/routing/`
- Channel base: `src/channels/`

## Security Considerations
- DM pairing policy should be enabled (dmPolicy="pairing")
- Verify channel tokens are stored securely
- Check allowlist configurations
- Review group message routing and mention gating

## Documentation
Channel docs live in `docs/channels/`

## Channel Request
$ARGUMENTS
