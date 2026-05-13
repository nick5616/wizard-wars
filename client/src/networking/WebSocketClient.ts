import { C2S, S2C } from "shared/events";
import { CLOCK_SYNC_INTERVAL } from "shared/constants";
import { ClockSync } from "./ClockSync";
import { useNetworkStore } from "../stores/networkStore";

type MessageHandler = (msg: Record<string, unknown>) => void;

export class WebSocketClient {
    private ws: WebSocket | null = null;
    private url: string;
    private clockSync: ClockSync;
    private clockSyncTimer: ReturnType<typeof setInterval> | null = null;
    private handlers = new Map<string, MessageHandler[]>();
    private reconnectDelay = 1000;
    private _destroyed = false;
    private _generation = 0;

    constructor(url: string, clockSync: ClockSync) {
        this.url = url;
        this.clockSync = clockSync;
    }

    connect() {
        this._destroyed = false;
        const gen = ++this._generation;

        // Silence the old socket so its onclose doesn't trigger a reconnect loop.
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
        }

        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            console.log("[WS] Connected");
            useNetworkStore.getState().setConnected(true);
            this.reconnectDelay = 1000;
            this._startClockSync();
        };

        this.ws.onmessage = (ev) => {
            try {
                const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
                this._dispatch(msg);
            } catch {
                // ignore malformed
            }
        };

        this.ws.onclose = (event) => {
            if (gen !== this._generation) return; // stale socket, ignore
            console.log(`[WS] Disconnected (code=${event.code}, reason="${event.reason}", wasClean=${event.wasClean})`);
            useNetworkStore.getState().setConnected(false);
            this._stopClockSync();
            if (!this._destroyed) {
                setTimeout(() => this.connect(), this.reconnectDelay);
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000);
            }
        };

        this.ws.onerror = (event) => {
            if (gen !== this._generation) return;
            console.error("[WS] Error:", event);
            this.ws?.close();
        };
    }

    disconnect() {
        this._destroyed = true;
        this._stopClockSync();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.close();
        }
    }

    send(type: string, payload: Record<string, unknown> = {}) {
        if (this.ws?.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify({ type, ...payload }));
    }

    on(type: string, handler: MessageHandler) {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type)!.push(handler);
        return () => this.off(type, handler);
    }

    off(type: string, handler: MessageHandler) {
        const arr = this.handlers.get(type);
        if (arr) {
            const idx = arr.indexOf(handler);
            if (idx >= 0) arr.splice(idx, 1);
        }
    }

    private _dispatch(msg: Record<string, unknown>) {
        const type = msg.type as string;

        // Handle clock sync internally
        if (type === S2C.CLOCK_SYNC) {
            this.clockSync.onResponse(
                msg.t1 as number,
                msg.t2 as number,
                msg.t3 as number,
            );
            useNetworkStore.getState().setRtt(this.clockSync.rtt);
            return;
        }

        const handlers = this.handlers.get(type) ?? [];
        for (const h of handlers) h(msg);
    }

    private _startClockSync() {
        this._sendClockSync();
        this.clockSyncTimer = setInterval(
            () => this._sendClockSync(),
            CLOCK_SYNC_INTERVAL,
        );
    }

    private _stopClockSync() {
        if (this.clockSyncTimer) {
            clearInterval(this.clockSyncTimer);
            this.clockSyncTimer = null;
        }
    }

    private _sendClockSync() {
        this.send(C2S.CLOCK_SYNC, { t1: Date.now() });
    }

    get rtt() {
        return this.clockSync.rtt;
    }
    get serverNow() {
        return this.clockSync.serverNow();
    }
}
