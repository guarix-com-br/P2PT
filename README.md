# @p2p-framework/core

General-purpose, modular peer-to-peer communication framework for the browser:
peer discovery over WebTorrent-compatible trackers, WebRTC data/media
communication, messaging, RPC, streaming, resumable file transfer, state sync,
rooms, presence and diagnostics — built on a replaceable transport layer.

**Status: Phase 1 (Foundation) complete.** The project scaffolding,
configuration system, typed event bus, public API skeleton and every plane's
interfaces are implemented, tested and building. Discovery (Phase 2) and all
later phases are not yet implemented; calling into them throws a clear
`NotImplementedError` that names the exact method and its planned phase.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design rationale.

## Quick start

```bash
npm install
npm run build     # tsc declarations + Vite library bundle -> dist/
npm test          # vitest
npm run lint      # eslint
npm run typecheck # tsc --noEmit
```

## Usage today (Phase 1 surface)

```ts
import { P2PClient } from "@p2p-framework/core";

const client = new P2PClient({
  appId: "my-app", // required: namespaces tracker/discovery scope
  peerName: "alice",
  maxPeers: 32, // validated resource limits
});

// Fully typed events (payloads inferred per event name)
client.on("peer:connected", (e) => console.log("peer up", e.peerId));

// Working now: config, identity, event bus, peer/room registries
console.log(client.id, client.config.maxMessageSize);

// Not yet live: facades exist with their future types and fail loudly
client.data.messaging.send("peer-1", { type: "chat", text: "hi" });
// -> NotImplementedError: client.data.messaging.send() is not implemented
//    yet (planned for Phase 5).
```

## What Phase 1 delivers

| Area                | Module                                                                            | State                                                    |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Public entry point  | `src/core/P2PClient.ts`                                                           | skeleton + working config/identity/events                |
| Peer & Room handles | `src/core/Peer.ts`, `src/core/Room.ts`                                            | typed handles, lifecycle shape                           |
| Typed events        | `src/core/events.ts`                                                              | complete (`TypedEventEmitter`, `P2PEvents`)              |
| Errors              | `src/core/errors.ts`                                                              | complete (`P2PError` hierarchy, stable codes)            |
| Configuration       | `src/config/Config.ts`                                                            | complete (defaults + validation)                         |
| Transport contracts | `src/transport/*`                                                                 | interfaces (`DataTransport`, `MediaTransport`, channels) |
| Control plane       | `src/control`, `src/discovery`, `src/signaling`, `src/capability`, `src/presence` | interfaces                                               |
| Data plane          | `src/data`, `src/transfer`, `src/protocol`                                        | interfaces + stable wire constants                       |
| Media plane         | `src/media`                                                                       | interfaces                                               |
| Stats / security    | `src/stats`, `src/security`                                                       | types + limit validation                                 |

## Roadmap (from PROMPT.md)

Phase 2 Discovery · Phase 3 Signaling · Phase 4 WebRTC transport ·
Phases 5–8 data plane (messaging/RPC/streaming/file transfer) ·
Phases 9–12 media plane · Phase 13 rooms & presence · Phase 14 recovery ·
Phase 15 diagnostics · Phase 16 security · Phase 17 hardening ·
Phase 18 docs & release.

## Requirements

- Node.js ≥ 20 (tooling), modern evergreen browsers (runtime).
- Zero runtime dependencies.

## License

MIT
