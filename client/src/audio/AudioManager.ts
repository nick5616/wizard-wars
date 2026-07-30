import { SOUND_MANIFEST, type SoundId } from './soundManifest';
import { useAudioStore } from '../stores/audioStore';

// Fail-graceful sound engine: any missing file, decode error, or blocked
// AudioContext results in a silent no-op, never a thrown error. Until real
// assets are dropped into client/public/audio/, the whole game runs sound-free.

interface PlayOpts {
  volume?: number; // extra multiplier on top of the manifest/category volume
}

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;

  private buffers = new Map<string, AudioBuffer | null>(); // null = known-missing/failed
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private warned = new Set<string>();

  private musicSource: AudioBufferSourceNode | null = null;
  private currentMusicId: string | null = null;
  private unlocked = false;

  /** Call once after a user gesture (click/keydown) -- browsers block audio before that. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return; // no Web Audio support -> stay silent forever, not fatal
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.musicGain = this.ctx.createGain();
      this.sfxGain.connect(this.masterGain);
      this.musicGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.applyVolumesFromStore();
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null; // any failure here just means: no sound, ever
    }
  }

  applyVolumesFromStore() {
    if (!this.masterGain || !this.sfxGain || !this.musicGain) return;
    const { muted, sfxVolume, musicVolume } = useAudioStore.getState();
    this.masterGain.gain.value = muted ? 0 : 1;
    this.sfxGain.gain.value = sfxVolume;
    this.musicGain.gain.value = musicVolume;
  }

  private async loadBuffer(id: string): Promise<AudioBuffer | null> {
    if (this.buffers.has(id)) return this.buffers.get(id)!;
    const existing = this.pending.get(id);
    if (existing) return existing;

    const def = SOUND_MANIFEST[id as SoundId];
    if (!def || !this.ctx) {
      this.buffers.set(id, null);
      return null;
    }

    const promise = fetch(`/audio/${def.src}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((arrayBuffer) => this.ctx!.decodeAudioData(arrayBuffer))
      .then((buf) => {
        this.buffers.set(id, buf);
        return buf;
      })
      .catch((err) => {
        if (import.meta.env.DEV && !this.warned.has(id)) {
          this.warned.add(id);
          // eslint-disable-next-line no-console
          console.debug(`[audio] "${id}" not available yet (${err?.message ?? err}) -- skipping silently`);
        }
        this.buffers.set(id, null);
        return null;
      })
      .finally(() => {
        this.pending.delete(id);
      });

    this.pending.set(id, promise);
    return promise;
  }

  /** Fire-and-forget one-shot SFX. Safe to call every frame/spam -- no-ops if unavailable. */
  async playSound(id: string, opts: PlayOpts = {}) {
    if (!this.ctx || !this.sfxGain) return;
    const def = SOUND_MANIFEST[id as SoundId];
    if (!def) return;

    const buffer = await this.loadBuffer(id);
    if (!buffer || !this.ctx || !this.sfxGain) return; // context may have been torn down mid-await

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    if (def.pitchVariance) {
      const variance = def.pitchVariance;
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * variance;
    }

    const gain = this.ctx.createGain();
    gain.gain.value = (def.volume ?? 1) * (opts.volume ?? 1);
    source.connect(gain);
    gain.connect(this.sfxGain);
    source.start(0);
  }

  /** Swaps the looping music bed with a short linear crossfade. No-ops gracefully if unavailable. */
  async playMusic(id: string, { fadeMs = 800 }: { fadeMs?: number } = {}) {
    if (this.currentMusicId === id) return;
    this.currentMusicId = id;
    if (!this.ctx || !this.musicGain) return;

    const def = SOUND_MANIFEST[id as SoundId];
    const buffer = def ? await this.loadBuffer(id) : null;

    const prevSource = this.musicSource;
    if (prevSource) {
      try {
        prevSource.stop(this.ctx.currentTime + fadeMs / 1000);
      } catch {
        /* already stopped */
      }
    }

    if (!buffer || this.currentMusicId !== id) {
      this.musicSource = null;
      return; // fails gracefully: no track playing, not an error
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = def!.loop ?? true;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime((def!.volume ?? 1), this.ctx.currentTime + fadeMs / 1000);
    source.connect(gain);
    gain.connect(this.musicGain);
    source.start(0);
    this.musicSource = source;
  }

  stopMusic(fadeMs = 500) {
    this.currentMusicId = null;
    if (!this.musicSource || !this.ctx) return;
    try {
      this.musicSource.stop(this.ctx.currentTime + fadeMs / 1000);
    } catch {
      /* already stopped */
    }
    this.musicSource = null;
  }
}

export const audioManager = new AudioManager();

// Keep the mixer in sync whenever settings change (mute toggle, volume sliders, etc.)
useAudioStore.subscribe(() => audioManager.applyVolumesFromStore());
