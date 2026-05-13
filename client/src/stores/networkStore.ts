import { create } from 'zustand';

interface NetworkState {
  connected: boolean;
  rtt: number;
  localPlayerId: string | null;
  roomId: string | null;
  setConnected: (v: boolean) => void;
  setRtt: (ms: number) => void;
  setLocalPlayerId: (id: string) => void;
  setRoomId: (id: string) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  connected: false,
  rtt: 0,
  localPlayerId: null,
  roomId: null,
  setConnected: (v) => set({ connected: v }),
  setRtt: (ms) => set({ rtt: ms }),
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
  setRoomId: (id) => set({ roomId: id }),
}));
