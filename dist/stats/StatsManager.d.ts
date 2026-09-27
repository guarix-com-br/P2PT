/**
 * Network statistics contracts (spec §31, Phase 1 types only).
 *
 * `StatsManager` will normalize `RTCPeerConnection.getStats()` output into
 * the flat shape below so applications never parse raw RTCStats reports and
 * so non-WebRTC transports can emit the same numbers later.
 */
export interface PeerNetworkStats {
    peerId: string;
    timestamp: number;
    rttMs: number | undefined;
    jitterMs: number | undefined;
    /** 0..1 fraction over the sampling window. */
    packetLoss: number | undefined;
    /** Selected candidate pair diagnostics. */
    candidate: {
        local: string;
        remote: string;
        /** "host" | "srflx" | "relay" — NAT traversal outcome (spec §30). */
        type: string;
    } | undefined;
    channels: Array<{
        name: string;
        bytesSent: number;
        bytesReceived: number;
        messagesSent: number;
        messagesReceived: number;
    }>;
    tracks: Array<{
        trackId: string;
        kind: "audio" | "video" | "screen";
        bitrateBps: number | undefined;
        codec: string | undefined;
        framesPerSecond: number | undefined;
    }>;
}
export interface StatsManagerApi {
    /** Snapshot for one peer (undefined if no connection). */
    getPeerStats(peerId: string): Promise<PeerNetworkStats | undefined>;
    /** Start periodic collection; handler receives per-peer snapshots. */
    watch(intervalMs: number, handler: (stats: PeerNetworkStats) => void): () => void;
}
//# sourceMappingURL=StatsManager.d.ts.map