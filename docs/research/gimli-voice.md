# Gimli Voice and Phone Capabilities Research

**Date:** 2026-02-01
**Author:** Research Agent

---

## Executive Summary

Gimli has comprehensive voice and phone capabilities built as a modular system with three main pillars:

1. **Voice Call Plugin** - Full telephony integration for outbound/inbound phone calls
2. **Text-to-Speech (TTS) System** - Multi-provider audio generation for messages
3. **Speech-to-Text (STT) System** - Multi-provider audio transcription for voice notes

Plus a macOS-specific **Voice Wake** feature for hands-free interaction.

---

## 1. Voice Call Plugin (`extensions/voice-call/`)

### Overview
A dedicated plugin providing real-time phone call capabilities with bidirectional audio streaming, enabling AI-powered voice conversations over telephone networks.

### Supported Telephony Providers

| Provider | Type | Key Features |
|----------|------|--------------|
| **Twilio** | Primary | Programmable Voice API, Media Streams (WebSocket), TwiML, HMAC-SHA1 verification |
| **Telnyx** | Alternative | Call Control v2, Ed25519 signature verification |
| **Plivo** | Alternative | Voice API, XML-based call control, GetInput speech |
| **Mock** | Development | No-network testing/development |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Voice Call Plugin                          │
├─────────────────────────────────────────────────────────────────┤
│  index.ts          - Plugin registration, tools, gateway methods │
│  runtime.ts        - Runtime initialization                      │
│  manager.ts        - Call lifecycle management                   │
│  webhook.ts        - HTTP webhook endpoint handling              │
│  media-stream.ts   - WebSocket bidirectional audio streaming     │
│  telephony-tts.ts  - TTS audio generation for phone calls        │
│  telephony-audio.ts- mu-law encoding, audio chunking            │
├─────────────────────────────────────────────────────────────────┤
│  providers/                                                      │
│    twilio.ts       - Twilio API + Media Streams + TwiML         │
│    telnyx.ts       - Telnyx Call Control v2                      │
│    plivo.ts        - Plivo Voice API                             │
│    stt-openai-realtime.ts - OpenAI Realtime STT streaming       │
│    tts-openai.ts   - OpenAI TTS for telephony                   │
└─────────────────────────────────────────────────────────────────┘
```

### Call Modes

1. **Notify Mode** - One-way call: speak a message and hang up
2. **Conversation Mode** - Two-way: real-time bidirectional audio with AI responses

### Key Features

- **Outbound calls**: Initiate calls via CLI, tools, or gateway RPC
- **Inbound calls**: Accept calls with configurable allowlist policies
- **Real-time streaming**: Twilio Media Streams for bidirectional audio via WebSocket
- **Speech recognition**: During-call STT via OpenAI Realtime API or provider native
- **TTS playback**: Stream synthesized speech to caller
- **DTMF handling**: Touch-tone input recognition
- **Barge-in support**: Interrupt TTS when user speaks
- **Webhook tunneling**: ngrok, Tailscale funnel support for public URLs

### API Surface

**Gateway Methods:**
- `voicecall.initiate` - Start a call
- `voicecall.continue` - Continue conversation
- `voicecall.speak` - Speak to user during call
- `voicecall.end` - Hang up call
- `voicecall.status` - Check call status

**Tool:** `voice_call` with actions:
- `initiate_call`, `continue_call`, `speak_to_user`, `end_call`, `get_status`

**CLI:**
```bash
gimli voicecall call --to "+15555550123" --message "Hello"
gimli voicecall continue --call-id <id> --message "Follow-up"
gimli voicecall speak --call-id <id> --message "One moment"
gimli voicecall end --call-id <id>
gimli voicecall status --call-id <id>
gimli voicecall tail
gimli voicecall expose --mode funnel
```

### Audio Pipeline (Twilio Streaming)

```
┌─────────┐    mu-law     ┌──────────────┐    mu-law    ┌─────────────┐
│ Caller  │ ─────────────▶│ Twilio Media │─────────────▶│ MediaStream │
│ (phone) │◀───────────── │   Streams    │◀─────────────│  Handler    │
└─────────┘    mu-law     └──────────────┘    mu-law    └──────┬──────┘
                               WebSocket                        │
                                                                │
                        ┌───────────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐          ┌─────────────────┐
              │ OpenAI Realtime │          │  TTS Provider   │
              │      STT        │          │ (OpenAI/11Labs) │
              │ (gpt-4o-trans)  │          │                 │
              └────────┬────────┘          └────────┬────────┘
                       │                            │
                       │ transcript                 │ PCM→mu-law
                       ▼                            ▼
              ┌─────────────────────────────────────────────────┐
              │              Call Manager                        │
              │  - Conversation state                            │
              │  - AI response generation                        │
              │  - TTS queueing                                  │
              └─────────────────────────────────────────────────┘
```

### Configuration Example

```json5
{
  plugins: {
    entries: {
      "voice-call": {
        enabled: true,
        config: {
          provider: "twilio",
          fromNumber: "+15550001234",
          toNumber: "+15550005678",
          twilio: {
            accountSid: "ACxxxxxxxx",
            authToken: "..."
          },
          serve: { port: 3334, path: "/voice/webhook" },
          streaming: {
            enabled: true,
            streamPath: "/voice/stream"
          },
          tts: {
            provider: "openai",
            openai: { model: "gpt-4o-mini-tts", voice: "alloy" }
          }
        }
      }
    }
  }
}
```

---

## 2. Text-to-Speech (TTS) System (`src/tts/tts.ts`)

### Overview
Core TTS infrastructure for generating audio responses across messaging channels. Supports multiple providers with automatic fallback.

### Supported Providers

| Provider | Models | Voices | Output Formats |
|----------|--------|--------|----------------|
| **OpenAI** | `gpt-4o-mini-tts`, `tts-1`, `tts-1-hd` | alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer | mp3, opus, pcm |
| **ElevenLabs** | `eleven_multilingual_v2` | Custom voice IDs | mp3, opus, pcm |
| **Edge (Microsoft)** | Built-in | Neural voices (e.g., `en-US-MichelleNeural`) | mp3, ogg |

### Auto-Modes

- `off` - TTS disabled
- `always` - Generate audio for all replies
- `inbound` - Audio only for incoming voice messages
- `tagged` - Only when `[[tts:...]]` directive present

### Channel-Optimized Output

- **Telegram**: Opus @ 48kHz for voice notes
- **Default**: MP3 @ 44.1kHz/128kbps
- **Telephony**: PCM @ 8kHz mu-law (for phone calls)

### TTS Directives

Messages can include inline TTS directives:
```
[[tts:text="Hello world" voice="nova" provider="openai"]]
```

### Features

- **Summarization**: Long text automatically summarized before synthesis
- **Voice customization**: Per-user voice preferences
- **Fallback chain**: Try next provider if primary fails
- **User preferences**: Stored per-channel for personalization

### Configuration

```json5
{
  messages: {
    tts: {
      auto: "inbound",
      provider: "openai",
      openai: {
        model: "gpt-4o-mini-tts",
        voice: "alloy"
      },
      elevenlabs: {
        voiceId: "pMsXgVXv3BLzUgSXRplE",
        modelId: "eleven_multilingual_v2"
      }
    }
  }
}
```

---

## 3. Speech-to-Text (STT) System (`src/media-understanding/`)

### Overview
Audio transcription pipeline for converting voice notes and audio messages to text across channels.

### Supported Providers

| Provider | Models | Features |
|----------|--------|----------|
| **OpenAI** | `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, Whisper | Highest accuracy |
| **Deepgram** | `nova-3` | Fast, streaming support |
| **Google Cloud** | Speech-to-Text | Enterprise |
| **Groq** | Fast inference | Low latency |
| **Local CLIs** | sherpa-onnx, whisper-cpp, whisper.py | Offline/privacy |

### Auto-Detection Order

When no explicit config, Gimli auto-detects in order:
1. Local CLIs (sherpa-onnx → whisper-cli → whisper)
2. Gemini CLI
3. Provider APIs (OpenAI → Groq → Deepgram → Google)

### Configuration

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        maxBytes: 20971520,
        models: [
          { provider: "openai", model: "gpt-4o-mini-transcribe" },
          { provider: "deepgram", model: "nova-3" },
          { type: "cli", command: "whisper", args: ["--model", "base", "{{MediaPath}}"] }
        ]
      }
    }
  }
}
```

### Features

- **Multi-attachment**: Process multiple voice notes in single message
- **Template access**: Transcript available as `{{Transcript}}`
- **Size limits**: Configurable per-model byte limits
- **Command parsing**: Slash commands work from transcribed audio

---

## 4. Voice Wake (macOS only)

### Overview
Hands-free voice activation for the macOS app using on-device speech recognition.

**Location:** `src/infra/voicewake.ts`, `apps/macos/Sources/*/VoiceWake*`

### Modes

1. **Wake-word mode** (default):
   - Always-on speech recognizer listens for trigger words
   - Default triggers: "gimli", "claude", "computer"
   - On match, starts capture and auto-sends after silence

2. **Push-to-talk**:
   - Hold right Option key (or Cmd+Fn on macOS 26+)
   - Immediate capture without trigger
   - Release finalizes and sends

### Configuration

```json5
{
  voicewake: {
    triggers: ["gimli", "claude", "hey assistant"]
  }
}
```

### Gateway Methods

- `voicewake.get` - Get current triggers
- `voicewake.set` - Update trigger words

---

## 5. Channel-Specific Voice Support

### Telegram Voice Notes

**Location:** `src/telegram/voice.ts`

- Detects voice message format compatibility
- Auto-converts to Opus for voice note delivery
- Falls back to audio file if format incompatible

### Signal Audio

- Voice note transcription via STT pipeline
- Audio file attachments supported

### WhatsApp Audio

- Voice message transcription
- Audio reply generation via TTS

---

## 6. Integration Points

### CLI Commands

```bash
# Voice calls
gimli voicecall call --to "+1..." --message "Hello"
gimli voicecall status --call-id <id>

# TTS testing (implicit via message send)
gimli message send --channel telegram --to <id> --message "[[tts:Hello]]"

# Voice wake config
gimli config set voicewake.triggers '["gimli","assistant"]'
```

### Agent Tools

- `voice_call` - Initiate and manage phone calls
- Audio transcription runs automatically on voice messages

### Gateway RPC

- `voicecall.*` - Call management
- `voicewake.*` - Trigger configuration
- `tts.*` - TTS generation (internal)

---

## 7. Key Technologies

| Component | Technology |
|-----------|------------|
| Telephony streaming | WebSocket (Twilio Media Streams) |
| Audio encoding | mu-law @ 8kHz (telephony), PCM, Opus, MP3 |
| STT streaming | OpenAI Realtime API, Deepgram |
| TTS generation | OpenAI TTS API, ElevenLabs API, Edge TTS |
| Voice activation | Apple Speech framework (on-device) |
| Webhook security | HMAC-SHA1 (Twilio), Ed25519 (Telnyx), SHA256 (Plivo) |

---

## 8. Gaps and Future Considerations

### Current Limitations

1. **Voice Call plugin requires external telephony provider** - No built-in SIP/VoIP
2. **Voice Wake is macOS-only** - No Linux/Windows voice activation
3. **No real-time STT for messaging** - STT runs after full audio received
4. **Edge TTS not supported for phone calls** - Unreliable PCM output

### Potential Enhancements

1. SIP/WebRTC direct integration (bypass telephony providers)
2. Cross-platform voice wake (Linux via PipeWire, Windows via WASAPI)
3. Real-time streaming STT for messaging channels
4. Voice cloning/custom voice support
5. Multi-language conversation mode for calls

---

## 9. File Reference

| Path | Purpose |
|------|---------|
| `extensions/voice-call/` | Voice call plugin (Twilio/Telnyx/Plivo) |
| `src/tts/tts.ts` | Core TTS implementation |
| `src/media-understanding/` | STT providers and pipeline |
| `src/infra/voicewake.ts` | Voice wake configuration |
| `src/telegram/voice.ts` | Telegram voice note handling |
| `docs/plugins/voice-call.md` | Plugin documentation |
| `docs/nodes/audio.md` | Audio transcription docs |
| `docs/platforms/mac/voicewake.md` | macOS voice wake docs |
