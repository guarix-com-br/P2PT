# NEXT-GENERATION P2P COMMUNICATION FRAMEWORK

## Master Specification for Qwen Code

---

# 1. ROLE

You are a senior TypeScript and networking engineer specializing in:

* WebRTC
* WebRTC DataChannels
* WebRTC Audio/Video
* WebRTC Screen Sharing
* WebSocket
* WebTorrent-compatible trackers
* WebRTC signaling
* STUN/TURN
* NAT traversal
* P2P networking
* distributed systems
* binary protocols
* streaming protocols
* large file transfer
* real-time communication
* browser networking
* Node.js networking
* TypeScript library architecture

You are responsible for designing and implementing a modern, modular, production-oriented P2P communication framework.

The project is inspired by the architecture and ideas behind the `p2pt` project, but it must be an **independent implementation**.

Do NOT copy source code from P2PT.

Use its concepts only as architectural inspiration.

---

# 2. PROJECT OBJECTIVE

Build a general-purpose P2P communication framework capable of providing:

* peer discovery
* signaling
* WebRTC connection establishment
* P2P messaging
* RPC
* binary communication
* large file streaming
* resumable file transfer
* state synchronization
* presence
* capability negotiation
* audio communication
* video communication
* screen sharing
* multi-peer rooms
* connection recovery
* network diagnostics
* NAT traversal
* optional relay support

The framework must be reusable by completely different applications.

Examples:

```text
Chat application
Discord-like application
Video conferencing application
P2P file sharing
Collaborative application
Online game
Remote assistance application
Screen-sharing application
Distributed application
```

The framework itself must NOT contain application-specific concepts such as Discord servers, Discord channels, or Discord-specific UI.

---

# 3. FUNDAMENTAL ARCHITECTURAL PRINCIPLE

This project is NOT a messaging library with media features added later.

It is a **general-purpose P2P communication framework** in which:

* messaging
* binary transfer
* file streaming
* RPC
* state synchronization
* audio
* video
* screen sharing

are first-class capabilities.

All of them must be built on top of a shared connection-management architecture.

No single feature should become the architectural center of the project.

---

# 4. FOUR MAJOR PLANES

The architecture MUST explicitly separate the system into four major planes.

```text
                         P2P FRAMEWORK
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
       ▼                      ▼                      ▼
 CONTROL PLANE            DATA PLANE            MEDIA PLANE
       │                      │                      │
       │                      │                      ├── Audio
       │                      │                      ├── Video
       │                      │                      └── Screen
       │                      │
       │                      ├── Messages
       │                      ├── RPC
       │                      ├── Files
       │                      ├── Binary Streams
       │                      └── State Sync
       │
       ├── Signaling
       ├── Negotiation
       ├── Discovery
       ├── Presence
       ├── Capabilities
       └── Connection Management

                              │
                              ▼
                       TRANSPORT LAYER
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
             WebRTC P2P      SFU       Future Transport
                              │
                         WebTransport
                         QUIC
                         etc.
```

The four layers must remain independently replaceable.

---

# 5. TRANSPORT ABSTRACTION

Create a transport abstraction.

The application layer must NOT directly depend on `RTCPeerConnection`.

Conceptually:

```ts
interface Transport {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    send(data: Uint8Array): Promise<void>;
    close(): Promise<void>;
}
```

The exact interface should be designed properly during implementation.

Initial implementation:

```text
WebRTCTransport
```

Future-compatible implementations:

```text
SFUTransport
WebTransportTransport
```

The framework must be designed so that a future SFU or WebTransport implementation can be introduced without rewriting the application protocol.

---

# 6. CONTROL PLANE

The Control Plane manages everything necessary to establish and maintain communication.

Responsibilities:

```text
Discovery
Signaling
Peer identification
Room membership
Connection establishment
ICE
SDP
Capabilities
Presence
Negotiation
Connection state
Reconnection
Health monitoring
```

The Control Plane must NOT carry normal chat messages or file payloads.

---

# 7. DISCOVERY

Implement a provider-based discovery architecture.

```text
DiscoveryManager
    │
    ├── WebTorrentTrackerDiscovery
    ├── WebSocketDiscovery
    └── CustomDiscoveryProvider
```

Create a generic interface.

The initial provider must support WebTorrent-compatible trackers.

Support:

* tracker URLs
* WebSocket trackers
* peer discovery
* application identifiers
* room identifiers
* discovery lifecycle
* tracker connection state
* tracker failures
* retry

Do not tightly couple the framework to a specific tracker implementation.

---

# 8. SIGNALING

Create a generic signaling abstraction.

```text
SignalingManager
    │
    ├── TrackerSignaling
    ├── WebSocketSignaling
    └── CustomSignaling
```

Support:

* SDP offer
* SDP answer
* ICE candidates
* peer IDs
* room IDs
* signaling message types
* signaling timeouts
* retries
* connection negotiation

Signaling must be used only to establish/maintain communication.

Once WebRTC communication exists, application data must use the appropriate DataChannel/media transport.

---

# 9. WEBTORRENT TRACKER STRATEGY

Use WebTorrent-compatible trackers as one signaling/discovery mechanism.

The tracker is NOT the primary application data transport.

Architecture:

```text
Peer A
  │
  ├── WebSocket
  │
  ▼
Tracker
  │
  └── Discovery / Signaling
           │
           ▼
       Peer B
           │
           │
           └──── WebRTC P2P ────┐
                                │
                         Application Data
```

The framework must allow public trackers for experimentation but must not assume that public trackers are reliable production infrastructure.

Support custom/private trackers through the provider abstraction.

---

# 10. PEER CONNECTION MANAGER

Create a dedicated `PeerConnectionManager`.

Responsibilities:

* RTCPeerConnection creation
* SDP negotiation
* ICE handling
* DataChannel creation
* media transceivers
* connection state
* ICE connection state
* signaling state
* peer lifecycle
* reconnect
* ICE restart
* cleanup

States:

```text
new
connecting
connected
disconnected
failed
closed
```

Implement deterministic cleanup.

Prevent memory leaks.

Prevent stale peer objects.

---

# 11. DATA PLANE

The Data Plane carries application data.

It MUST be independent of the Media Plane.

```text
DATA PLANE
│
├── Messaging
├── RPC
├── File Transfer
├── Binary Streams
├── State Synchronization
└── Presence Payloads
```

The Data Plane should primarily use WebRTC DataChannels.

---

# 12. DATA CHANNEL ARCHITECTURE

Do not automatically put every type of data into a single DataChannel.

Design logical channels.

Recommended initial architecture:

```text
control
messages
rpc
files
sync
```

Choose reliability according to use case.

Examples:

```text
Chat:
ordered + reliable

RPC:
ordered + reliable

File transfer:
ordered + reliable

State synchronization:
configurable

Real-time telemetry:
potentially unordered / low retransmission
```

Document all decisions.

Avoid creating excessive DataChannels unnecessarily.

---

# 13. BINARY PROTOCOL

Create a versioned binary framing protocol.

Conceptual frame:

```text
┌────────────────────┐
│ Protocol Version   │
├────────────────────┤
│ Message Type       │
├────────────────────┤
│ Flags              │
├────────────────────┤
│ Stream ID          │
├────────────────────┤
│ Message ID         │
├────────────────────┤
│ Sequence Number    │
├────────────────────┤
│ Payload Length     │
├────────────────────┤
│ Payload            │
└────────────────────┘
```

Support:

* versioning
* message type
* flags
* stream IDs
* message IDs
* sequence numbers
* payload length
* binary payloads
* JSON payloads where appropriate

Implement:

```text
Encoder
Decoder
Validator
Frame parser
Frame serializer
```

The protocol must be extensible.

---

# 14. MESSAGING

Implement high-level messaging.

Example conceptual API:

```ts
await peer.sendMessage({
    type: "chat",
    payload: {
        text: "Hello"
    }
});
```

Support:

* strings
* JSON
* Uint8Array
* ArrayBuffer
* Blob where supported

Implement:

```text
send()
broadcast()
subscribe()
unsubscribe()
```

Messages must include IDs where necessary.

---

# 15. RPC

Implement request/response RPC.

Example:

```ts
const result = await peer.request("getUser", {
    userId: "123"
});
```

Support:

* request IDs
* response IDs
* timeout
* cancellation
* errors
* concurrent requests
* maximum pending requests

Use `AbortController` where appropriate.

---

# 16. LARGE FILE STREAMING

File transfer must be a first-class feature.

Do NOT load entire large files into memory.

Architecture:

```text
File / Blob / ReadableStream
             │
             ▼
          Chunker
             │
             ▼
       Flow Controller
             │
             ▼
        DataChannel
             │
             ▼
       Flow Controller
             │
             ▼
        Reassembler
             │
             ▼
       WritableStream
```

Support:

* File
* Blob
* ArrayBuffer
* Uint8Array
* ReadableStream
* WritableStream

Features:

* metadata
* chunking
* sequence numbers
* progress
* pause
* resume
* cancellation
* checksum
* integrity verification
* backpressure
* transfer timeout
* transfer recovery
* concurrent transfers

---

# 17. FILE TRANSFER PROTOCOL

Create dedicated message types:

```text
FILE_START
FILE_ACCEPT
FILE_CHUNK
FILE_ACK
FILE_PAUSE
FILE_RESUME
FILE_CANCEL
FILE_COMPLETE
FILE_ERROR
```

The protocol must support future resumable transfers.

Example metadata:

```ts
{
    transferId,
    fileName,
    mimeType,
    size,
    chunkSize,
    checksum
}
```

Implement flow control.

Never continuously push data when the receiver cannot keep up.

---

# 18. STREAMING ABSTRACTION

Create a generic streaming abstraction that is not limited to files.

Possible streams:

```text
File Stream
Binary Stream
Application Stream
Future Data Stream
```

Conceptually:

```text
StreamManager
    │
    ├── FileStream
    ├── BinaryStream
    └── CustomStream
```

This allows future streaming features without redesigning the transport layer.

---

# 19. MEDIA PLANE

The Media Plane handles real-time media.

It MUST NOT use DataChannels for audio/video.

Use WebRTC media tracks.

```text
MEDIA PLANE
│
├── Audio
├── Video
└── Screen Sharing
```

---

# 20. SHARED RTCPeerConnection

Prefer a shared `RTCPeerConnection` per peer.

Conceptually:

```text
RTCPeerConnection
│
├── DataChannel
│
├── Audio Track
│
├── Video Track
│
└── Screen Share Track
```

Do NOT create independent peer connections for every media type unless a documented technical reason exists.

Use:

* RTCRtpSender
* RTCRtpReceiver
* RTCRtpTransceiver
* replaceTrack()
* addTrack()
* removeTrack()

where appropriate.

---

# 21. AUDIO

Create:

```text
AudioManager
```

Support:

* microphone acquisition
* remote audio
* mute/unmute
* enable/disable
* track replacement
* audio constraints
* remote stream management

Use:

```ts
navigator.mediaDevices.getUserMedia({
    audio: true
});
```

Do not transport audio through DataChannels.

---

# 22. VIDEO

Create:

```text
VideoManager
```

Support:

* camera
* remote video
* enable/disable
* track replacement
* video constraints
* multiple remote streams

Use WebRTC video tracks.

---

# 23. SCREEN SHARING

Create:

```text
ScreenShareManager
```

Use:

```ts
navigator.mediaDevices.getDisplayMedia()
```

Support:

* screen
* window
* browser tab where supported
* stop sharing
* track replacement
* simultaneous camera + screen when technically possible

Do not assume every browser supports every capture mode.

---

# 24. MEDIA TRANSPORT ABSTRACTION

Do not make the application directly dependent on WebRTC media APIs.

Create:

```text
MediaTransport
```

Initial implementation:

```text
WebRTCMediaTransport
```

Future:

```text
SFUMediaTransport
```

This allows large rooms to migrate from mesh P2P to an SFU architecture.

---

# 25. P2P VS SFU

The architecture must explicitly acknowledge the difference between:

```text
P2P Mesh
```

and:

```text
SFU
```

P2P mesh:

```text
A ─── B
│╲   ╱│
│ ╲ ╱ │
│  X  │
│ ╱ ╲ │
C ─── D
```

SFU:

```text
        SFU
      /  |  \
     A   B   C
```

The application layer must not care which architecture is being used.

Create abstractions that make this possible.

---

# 26. ROOMS

Implement generic room management.

```text
Room
│
├── Room ID
├── Local Peer
├── Remote Peers
├── Metadata
├── Capabilities
└── Presence
```

Support:

```text
joinRoom()
leaveRoom()
getPeers()
```

Room identifiers must participate in discovery.

---

# 27. PRESENCE

Implement lightweight presence.

Example:

```ts
{
    peerId,
    metadata,
    status,
    capabilities
}
```

Use change detection.

Do not constantly broadcast unchanged state.

---

# 28. CAPABILITY NEGOTIATION

Peers must advertise capabilities.

Example:

```text
messaging
binary
files
rpc
audio
video
screenShare
```

Before using a feature, verify that the remote peer supports it.

Version capabilities where necessary.

---

# 29. CONNECTION RECOVERY

Implement:

```text
connection lost
      ↓
detect
      ↓
backoff
      ↓
ICE restart
      ↓
renegotiation
      ↓
reconnect
      ↓
state synchronization
```

Use exponential backoff.

Avoid infinite aggressive reconnect loops.

---

# 30. NAT TRAVERSAL

Support:

* STUN
* TURN

Use configurable ICE servers.

Support candidate types:

```text
host
srflx
relay
```

Expose diagnostics.

Do not assume direct P2P connectivity is always possible.

---

# 31. NETWORK STATISTICS

Implement:

```ts
RTCPeerConnection.getStats()
```

Normalize:

* RTT
* jitter
* packet loss
* bitrate
* bytes sent
* bytes received
* codec
* candidate pair
* connection type
* audio statistics
* video statistics
* DataChannel statistics

Expose a clean API.

---

# 32. SECURITY

Treat every remote peer as untrusted.

Implement:

* strict frame validation
* message validation
* size limits
* rate limits
* timeout limits
* pending request limits
* concurrent transfer limits
* peer limits
* malformed frame rejection
* protocol version validation

Use WebRTC's:

```text
DTLS
SRTP
```

for media security.

Do not implement redundant custom encryption unless there is a documented requirement.

---

# 33. RESOURCE PROTECTION

Configurable limits:

```text
maxMessageSize
maxFileSize
maxChunkSize
maxConcurrentTransfers
maxPendingRequests
maxPeers
requestTimeout
transferTimeout
reconnectAttempts
```

Protect against:

* memory exhaustion
* malicious peers
* oversized packets
* malformed protocols
* request floods
* connection floods

---

# 34. EVENT-DRIVEN ARCHITECTURE

Use a strongly typed event system.

Events:

```text
tracker:connected
tracker:disconnected
tracker:error

peer:discovered
peer:connecting
peer:connected
peer:disconnected
peer:error

room:joined
room:left

message
rpc:request
rpc:response

file:started
file:progress
file:paused
file:resumed
file:completed
file:error

audio:started
audio:stopped

video:started
video:stopped

screen:started
screen:stopped

connection:statechange
```

Do not expose unnecessary internal events.

---

# 35. PROJECT STRUCTURE

Use a modular architecture similar to:

```text
src/
│
├── core/
│   ├── P2PClient.ts
│   ├── Peer.ts
│   ├── Room.ts
│   └── events.ts
│
├── control/
│   ├── ControlPlane.ts
│   ├── DiscoveryManager.ts
│   ├── SignalingManager.ts
│   ├── CapabilityManager.ts
│   ├── PresenceManager.ts
│   └── ConnectionManager.ts
│
├── discovery/
│   ├── DiscoveryProvider.ts
│   ├── WebTorrentTrackerDiscovery.ts
│   └── WebSocketDiscovery.ts
│
├── signaling/
│   ├── SignalingProvider.ts
│   ├── TrackerSignaling.ts
│   └── WebSocketSignaling.ts
│
├── transport/
│   ├── Transport.ts
│   ├── WebRTCTransport.ts
│   ├── MediaTransport.ts
│   └── DataTransport.ts
│
├── webrtc/
│   ├── PeerConnection.ts
│   ├── DataChannelManager.ts
│   ├── IceManager.ts
│   └── NegotiationManager.ts
│
├── protocol/
│   ├── Frame.ts
│   ├── Encoder.ts
│   ├── Decoder.ts
│   ├── MessageTypes.ts
│   └── ProtocolVersion.ts
│
├── data/
│   ├── DataPlane.ts
│   ├── MessageManager.ts
│   ├── RpcManager.ts
│   ├── StreamManager.ts
│   └── StateSyncManager.ts
│
├── transfer/
│   ├── FileTransfer.ts
│   ├── Chunker.ts
│   ├── Reassembler.ts
│   ├── FlowController.ts
│   └── TransferManager.ts
│
├── media/
│   ├── MediaPlane.ts
│   ├── AudioManager.ts
│   ├── VideoManager.ts
│   └── ScreenShareManager.ts
│
├── stats/
│   └── StatsManager.ts
│
├── security/
│   ├── Validation.ts
│   ├── Limits.ts
│   └── RateLimiter.ts
│
└── index.ts
```

Modify this structure if a better design is discovered.

Do not force an architecture that creates unnecessary abstraction.

---

# 36. TECHNOLOGY STACK

Use:

```text
TypeScript
ESM
Vite
Vitest
ESLint
Prettier
```

Prefer browser-native APIs.

Dependencies must be minimal.

Potential dependencies may include:

```text
bittorrent-tracker
```

or an equivalent WebTorrent tracker implementation if technically justified.

Do not blindly reproduce P2PT's dependency list.

Evaluate each dependency.

---

# 37. BROWSER AND NODE SUPPORT

The framework should support:

```text
Browser
Node.js
```

where the underlying WebRTC APIs are available.

Use platform-specific adapters where necessary.

Do not pollute browser code with unnecessary Node-specific APIs.

---

# 38. LOCAL DEVELOPMENT

Provide local infrastructure for testing.

Create:

```text
local tracker
local signaling server
test peers
```

Automated tests must NOT depend on public trackers.

Public trackers may be used in manual examples only.

---

# 39. TESTING STRATEGY

Use Vitest.

Unit tests:

```text
Protocol
Encoder
Decoder
Chunker
Reassembler
RPC
State synchronization
Validation
Rate limiting
```

Integration tests:

```text
Peer A ↔ Peer B
```

Test:

```text
connection
messaging
binary data
RPC
file transfer
reconnection
```

Media tests should use appropriate browser mocks where necessary.

---

# 40. EXAMPLES

Create:

```text
examples/
├── basic-chat/
├── rpc/
├── file-transfer/
├── audio-call/
├── video-call/
├── screen-share/
└── multi-peer-room/
```

All examples must use the public API.

Do not import internal modules.

---

# 41. DEMO APPLICATION

Create a browser demo using:

```text
Vite
TypeScript
HTML
CSS
```

The demo must allow:

```text
Create room
Join room
View peers
Send messages
Send files
Start microphone
Start camera
Share screen
View connection state
View network statistics
```

Keep the demo independent from the core library.

---

# 42. DOCUMENTATION

Create:

```text
README.md
ARCHITECTURE.md
CONTROL_PLANE.md
DATA_PLANE.md
MEDIA_PLANE.md
TRANSPORT.md
PROTOCOL.md
SIGNALING.md
FILE_TRANSFER.md
SECURITY.md
API.md
CONTRIBUTING.md
```

Documentation must explain architectural reasoning.

Do not merely document function signatures.

---

# 43. PERFORMANCE

Optimize for:

* minimal memory copies
* streaming
* backpressure
* efficient binary encoding
* low allocation
* minimal renegotiation
* efficient broadcasts
* efficient peer state tracking

Large files must never be unnecessarily loaded completely into memory.

---

# 44. SCALABILITY

Explicitly document that P2P mesh has scalability limitations.

The framework must support:

```text
Small P2P rooms
```

while being architecturally prepared for:

```text
Large rooms using SFU
```

Do not claim unlimited scalability.

---

# 45. FUTURE TRANSPORTS

The architecture should allow future:

```text
WebTransport
QUIC
SFU
custom relay
```

without rewriting:

```text
Messaging
RPC
File Transfer
Application Protocol
```

---

# 46. FUTURE FEATURES

Design extension points for:

* SFU
* distributed state
* CRDT
* resumable transfers
* decentralized identity
* distributed file sharing
* peer reputation
* offline synchronization
* WebTransport
* QUIC
* application-level encryption
* service workers

Do not implement these unless explicitly requested.

---

# 47. DEVELOPMENT PHILOSOPHY

Never implement the entire system at once.

Each phase must leave the repository functional.

After every phase:

```text
1. Build
2. Test
3. Lint
4. Fix errors
5. Review architecture
6. Update documentation
7. Verify public API
```

Do not proceed if the current phase is broken.

---

# PHASE 1 — FOUNDATION

Implement:

* TypeScript
* ESM
* Vite
* Vitest
* ESLint
* Prettier
* project structure
* configuration system
* typed events
* public API skeleton
* transport interfaces
* control plane interfaces
* data plane interfaces
* media plane interfaces

Do not implement actual WebRTC yet.

Deliver:

```text
npm install
npm run build
npm test
npm run lint
```

All must work.

---

# PHASE 2 — DISCOVERY

Implement:

* DiscoveryProvider
* WebTorrent tracker discovery
* application identifiers
* room identifiers
* tracker lifecycle
* peer discovery
* local tracker tests

Do not implement application messaging yet.

---

# PHASE 3 — SIGNALING

Implement:

* SignalingProvider
* WebTorrent tracker signaling
* SDP exchange
* ICE candidate exchange
* signaling timeouts
* retry mechanism

Keep signaling isolated from application data.

---

# PHASE 4 — WEBRTC TRANSPORT

Implement:

* RTCPeerConnection
* ICE
* DataChannels
* peer lifecycle
* connection state
* cleanup
* reconnection foundation

Deliver:

```text
Peer A ↔ Peer B
```

with a working DataChannel.

---

# PHASE 5 — DATA PLANE

Implement:

* binary protocol
* framing
* encoding
* decoding
* messages
* binary data
* broadcast

Deliver:

```text
A → B
B → A
A → all
```

---

# PHASE 6 — RPC

Implement:

* request
* response
* Promise API
* timeout
* cancellation
* errors

---

# PHASE 7 — STREAMING ENGINE

Implement the generic streaming abstraction.

Support:

* streams
* chunks
* sequence numbers
* flow control
* backpressure
* cancellation

This phase must NOT be file-specific.

---

# PHASE 8 — FILE TRANSFER

Build file transfer on top of the generic streaming engine.

Implement:

* metadata
* chunking
* progress
* pause
* resume
* cancellation
* checksum
* integrity
* recovery

---

# PHASE 9 — MEDIA PLANE

Implement:

* MediaTransport
* WebRTC media
* transceivers
* audio
* video
* remote streams

---

# PHASE 10 — AUDIO

Implement:

* microphone
* remote audio
* mute
* unmute
* track replacement

Create audio-call example.

---

# PHASE 11 — VIDEO

Implement:

* camera
* remote video
* track replacement
* constraints

Create video-call example.

---

# PHASE 12 — SCREEN SHARING

Implement:

* getDisplayMedia
* screen track
* track replacement
* stop sharing
* simultaneous camera/screen support where possible

Create screen-share example.

---

# PHASE 13 — ROOMS AND PRESENCE

Implement:

* rooms
* peer metadata
* presence
* capabilities
* synchronization

Create multi-peer example.

---

# PHASE 14 — RECOVERY

Implement:

* connection recovery
* ICE restart
* exponential backoff
* state synchronization
* dead-peer detection

---

# PHASE 15 — NETWORK DIAGNOSTICS

Implement:

* getStats()
* normalized statistics
* RTT
* jitter
* packet loss
* bitrate
* candidate pair
* transport diagnostics

---

# PHASE 16 — SECURITY

Implement:

* validation
* limits
* rate limiting
* malformed frame handling
* protocol version validation
* resource protection

---

# PHASE 17 — PRODUCTION HARDENING

Review the entire project for:

* memory leaks
* event listener leaks
* race conditions
* connection leaks
* unhandled promises
* browser compatibility
* Node compatibility
* performance
* error handling

Run the complete test suite.

---

# PHASE 18 — DOCUMENTATION AND RELEASE

Complete:

* README
* architecture docs
* API docs
* protocol docs
* examples
* changelog
* contribution guide

Prepare the package for npm publication.

---

# CRITICAL RULES

1. Do not copy P2PT source code.
2. Do not reproduce P2PT implementation details unnecessarily.
3. Use P2PT as architectural inspiration only.
4. Control Plane, Data Plane, Media Plane and Transport Layer must remain separated.
5. Do not make messaging the architectural center.
6. Do not make media the architectural center.
7. Do not couple the application layer directly to WebRTC APIs.
8. Do not couple discovery directly to a specific tracker.
9. Do not couple signaling to application data.
10. Do not use DataChannels for real-time audio/video.
11. Use WebRTC media tracks for audio/video/screen sharing.
12. Prefer a shared RTCPeerConnection per peer.
13. Use backpressure for streaming.
14. Never load huge files entirely into memory unnecessarily.
15. Validate all remote input.
16. Implement timeouts.
17. Implement cleanup.
18. Implement reconnection carefully.
19. Keep public APIs minimal and stable.
20. Keep every phase buildable and testable.
21. Do not implement future phases prematurely.
22. Do not add dependencies without justification.
23. Do not claim P2P mesh scales indefinitely.
24. Keep the architecture compatible with a future SFU.
25. Keep the architecture compatible with future WebTransport/QUIC transports.

---

# FIRST TASK

Before writing implementation code:

1. Inspect the current repository.
2. Analyze the requirements.
3. Produce the proposed architecture.
4. Produce the directory structure.
5. Identify dependencies and justify each dependency.
6. Identify browser APIs.
7. Identify protocol decisions.
8. Identify major risks.
9. Explain the Control Plane.
10. Explain the Data Plane.
11. Explain the Media Plane.
12. Explain the Transport Layer.
13. Explain how WebTorrent trackers will be used.
14. Explain how WebRTC will be established.
15. Explain how the architecture can later support SFU.
16. Produce the Phase 1 implementation plan.

Then implement **PHASE 1 ONLY**.

Do not implement Phase 2 or later.

At the end, report:

```text
IMPLEMENTED

TESTS

FILES CREATED

FILES MODIFIED

DEPENDENCIES ADDED

ARCHITECTURAL DECISIONS

KNOWN LIMITATIONS

NEXT PHASE
```

Do not continue automatically to the next phase.
