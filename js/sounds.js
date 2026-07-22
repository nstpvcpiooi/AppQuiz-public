import { SOUND_CONFIG } from './config/sounds.js';

const STORAGE_KEY = 'quizSoundEnabled';

let audioCtx = null;

function getContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function normalizeSources(value) {
    if (!value) return [];
    return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function pickRandomSource(sources) {
    if (!sources.length) return null;
    return sources[Math.floor(Math.random() * sources.length)];
}

function playTone(frequency, duration, type = 'sine', volume = 0.15) {
    if (!isSoundEnabled()) return;
    try {
        const ctx = getContext();
        if (ctx.state === 'suspended') ctx.resume();

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + duration);
    } catch (e) {
        console.warn('Sound playback failed:', e);
    }
}

function playBuiltinCorrect() {
    playTone(587.33, 0.1, 'sine', 0.14);
    setTimeout(() => playTone(783.99, 0.15, 'sine', 0.12), 80);
    setTimeout(() => playTone(987.77, 0.2, 'sine', 0.1), 160);
}

function playBuiltinIncorrect() {
    playTone(196, 0.15, 'triangle', 0.12);
    setTimeout(() => playTone(155.56, 0.25, 'triangle', 0.1), 120);
}

function playBuiltinResult() {
    playTone(523.25, 0.12, 'sine', 0.13);
    setTimeout(() => playTone(659.25, 0.12, 'sine', 0.13), 90);
    setTimeout(() => playTone(783.99, 0.12, 'sine', 0.13), 180);
    setTimeout(() => playTone(1046.5, 0.28, 'sine', 0.12), 270);
}

function playBuiltin(type) {
    if (type === 'correct') playBuiltinCorrect();
    else if (type === 'result') playBuiltinResult();
    else playBuiltinIncorrect();
}

function playCustomOrBuiltin(type) {
    if (!isSoundEnabled()) return;

    const sources = normalizeSources(SOUND_CONFIG[type]);
    const src = pickRandomSource(sources);

    if (!src) {
        playBuiltin(type);
        return;
    }

    const audio = new Audio(src);
    audio.volume = SOUND_CONFIG.volume ?? 0.7;
    audio.play().catch(() => {
        console.info(`Custom ${type} sound not found at "${src}". Using built-in sound.`);
        playBuiltin(type);
    });
}

export function isSoundEnabled() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
}

export function setSoundEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, String(enabled));
}

export function playCorrectSound() {
    playCustomOrBuiltin('correct');
}

export function playIncorrectSound() {
    playCustomOrBuiltin('incorrect');
}

export function playResultSound() {
    playCustomOrBuiltin('result');
}

export const sounds = {
    play(type) {
        if (type === 'correct') playCorrectSound();
        else if (type === 'incorrect') playIncorrectSound();
        else if (type === 'result') playResultSound();
    },
    isEnabled: isSoundEnabled,
    setEnabled: setSoundEnabled
};
