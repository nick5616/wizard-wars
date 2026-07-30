import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AudioSettingsState {
  muted: boolean;
  sfxVolume: number; // 0-1
  musicVolume: number; // 0-1
  setMuted: (m: boolean) => void;
  setSfxVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
}

export const useAudioStore = create<AudioSettingsState>()(
  persist(
    (set) => ({
      muted: false,
      sfxVolume: 0.8,
      musicVolume: 0.5,
      setMuted: (m) => set({ muted: m }),
      setSfxVolume: (v) => set({ sfxVolume: Math.max(0, Math.min(1, v)) }),
      setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
    }),
    { name: 'wizardwars_audio_settings' },
  ),
);
