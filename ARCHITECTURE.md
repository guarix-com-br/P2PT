# Architecture

This document records the architectural decisions behind the P2P framework and
the current implementation status (Phase 1 — foundation only).

## The four planes

```text
┌───────────────────────────────────────────────────────┐
│  Application (your code)                              │
├───────────────────────────────────────────────────────┤
│  Control Plane   discovery · signaling · caps ·       │  ← who is out there,
│                  presence · connection lifecycle      │    how to reach them
├───────────────────────────────────────────────────────┤
│  Data Plane      messaging · RPC · streaming ·        │  ← application bytes,
│                  file transfer · state sync           │    reliably structured
├───────────────────────────────────────────────────────┤
│  Media Plane     audio · video · screen share         │  ← real-time media
├───────────────────────────────────────────────────────┤
│  Transport Layer DataTransport / MediaTransport       │  ← replaceable wire
│                  (WebRTC today; SFU/WebTransport      │
│                   adapters later)                     │
└───────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward: the data and media planes consume
transport interfaces; the control plane orchestrates transports but never
carries application payloads; nothing above the transport layer ever touches
`RTCPeerConnection` directly.

### Control Plane (`src/control`, `src/discovery`, `src/signaling`, `src/capability`, `src/presence`)

Finds peers (tracker-based discovery, Phase 2), exchanges SDP/ICE (signaling,
Phase 3), negotiates capabilities, tracks presence, and manages the connection
lifecycle (Phase 4 `ConnectionManager`). It moves **metadata only**.

### Data Plane (`src/data`, `src/transfer`, `src/protocol`)

Messaging, RPC, binary streaming, resumable file transfer and state sync run
over five logical channels (`control`, `messages`, `rpc`, `files`, `sync`)
defined in `src/transport/channels.ts`, each with its own reliability profile.
All channel traffic is framed by a versioned binary protocol whose stable type
registry lives in `src/protocol/MessageTypes.ts` and whose negotiation rules
live in `src/protocol/ProtocolVersion.ts`. Implementations arrive in Phases 5–8.

### Media Plane (`src/media`)

Audio/video/screen-share are carried over WebRTC **media tracks**, never
DataChannels, behind `MediaTransport` (`src/transport/MediaTransport.ts`). This
abstraction is what makes a later SFU swap possible without touching the
public API: an SFU adapter implements the same interface. Phases 9–12.

### Transport Layer (`src/transport`, `src/webrtc`)

`DataTransport` exposes byte pipes keyed by logical channel; `MediaTransport`
exposes track add/remove/replace. The WebRTC implementation lands in Phase 4
under `src/webrtc/`.

## Public API (`src/index.ts`)

One entry class, `P2PClient`, owns config resolution, identity, the typed event
bus and four facades: `client.control`, `client.data`, `client.media`,
`client.stats`. Handles (`Peer`, `Room`) are returned from lifecycle calls.
Every event name from the spec (`peer:connected`, `tracker:connected`,
`file:progress`, …) is declared in `src/core/events.ts` as a typed map, so
`client.on("message", handler)` gets an inferred payload.

Until their phases land, facade members are wired through a recursive
placeholder proxy (`notReady()` in `src/core/P2PClient.ts`): calling any method
at any nesting depth throws/rejects with a `NotImplementedError` naming the
exact call path and target phase (e.g.
`client.control.discovery.providers.tracker.start()` → "…planned for Phase 2").
Async members (`get*`, `watch*`) reject rather than throw synchronously so they
remain usable inside `await`.

## Configuration (`src/config/Config.ts`)

`resolveConfig(input)` merges user input over defaults and validates every
resource limit from the spec (`maxMessageSize`, `maxPeers`, `requestTimeout`,
`reconnectAttempts`, ICE servers, …). Failures produce a single
`ConfigValidationError` carrying field-level `issues[]`. Limits are also
exported standalone (`DEFAULT_LIMITS`, `validateLimits`) for reuse by the
security layer (Phase 16).

## Events (`src/core/events.ts`)

`TypedEventEmitter<EventMap>` is a small, dependency-free, fully-typed emitter
(no Node `events` import, browser-safe). `P2PClient` extends it. Reserved
payload types (e.g. `DiscoveredPeerInfo`) are exported so provider authors can
implement against them in Phase 2+.

## Error model (`src/core/errors.ts`)

Single hierarchy rooted at `P2PError` with stable string `code`s:
`NotImplementedError` (+ `phase`), `ValidationError`, `ConfigValidationError`
(+ `issues`), `TimeoutError`, `LimitExceededError`. One module avoids circular
imports between planes.

## Directory layout

```text
src/
├── core/        P2PClient, Peer, Room, events, errors, ids
├── config/      P2PConfig: defaults + validation
├── control/     ControlPlane facade types
├── discovery/   DiscoveryProvider contract (impl: Phase 2)
├── signaling/   SignalingProvider contract (impl: Phase 3)
├── capability/  capability registry types
├── presence/    presence manager types
├── transport/   Transport / DataTransport / MediaTransport / channels
├── webrtc/      reserved for Phase 4 implementation
├── protocol/    MessageType registry, protocol version negotiation
├── data/        DataPlane facade types (impl: Phases 5–8)
├── transfer/    file/stream transfer types (impl: Phases 7–8)
├── media/       MediaPlane facade types (impl: Phases 9–12)
├── stats/       diagnostics types (impl: Phase 15)
├── security/    resource limits & validation helpers (hardened Phase 16)
└── index.ts     curated public exports
tests/           vitest suites (config, events, api surface)
```

## Tooling decisions

- **ESM-only** (`"type": "module"`), TypeScript strict mode.
- **Vite** library-mode build (`vite.config.ts`) emits `dist/index.js` +
  source maps; `tsc` emits declarations (`dist/*.d.ts`).
- **Vitest** for unit tests; **ESLint 9 flat config** with typescript-eslint
  recommended rules; **Prettier** for formatting. The spec file `PROMPT.md` is
  excluded via `.prettierignore` — it is an input artifact kept byte-identical,
  not project source.
- **Zero runtime dependencies.** Everything needed (WebRTC, WebSocket, crypto)
  is a browser-native API; dev tooling only.

## Known limitations / risks

- Public trackers are unreliable; mitigated by the provider abstraction and a
  local tracker test harness planned for Phase 2.
- Mesh topology scales to roughly dozens of peers; SFU-ready abstractions are
  documented above, but no SFU implementation exists yet.
- Facade placeholders are typed as their future APIs; unknown members beyond
  the interface shape fail at runtime with a clear message rather than at
  compile time.
