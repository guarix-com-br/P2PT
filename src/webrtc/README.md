# webrtc/

Concrete WebRTC implementation (`PeerConnection`, `DataChannelManager`,
`IceManager`, `NegotiationManager`, `WebRTCTransport`) arrives in **Phase 4**.

This folder exists now so the module map matches the architecture; nothing
here imports browser globals yet, which keeps Phase-1 builds/tests pure.
