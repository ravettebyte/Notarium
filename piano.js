const NOTE_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const BLACK_PITCHES = new Set([1, 3, 6, 8, 10]);
const PITCHES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const WHITE_SHORTCUTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_SHORTCUTS = ['1', '2', '3', '4', '5'];
const PIANO_START_MIDI = 60;
const PIANO_END_MIDI = 84;
let audioContext;
let masterGain;
let compressor;
let volume = 0.72;

export function parseNote(value, defaultOctave = 4) {
  const match = String(value ?? '').trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const accidental = match[2].replace('♯', '#').replace('♭', 'b');
  const octave = match[3] === undefined ? Number(defaultOctave) : Number(match[3]);
  if (!Number.isInteger(octave) || octave < -1 || octave > 9) return null;
  const pitch = PITCHES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  const midi = (octave + 1) * 12 + pitch;
  return midi >= 0 && midi <= 127 ? midi : null;
}

export function parseNoteSpelling(value, defaultOctave = 4) {
  const match = String(value ?? '').trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d+)?$/);
  const midi = parseNote(value, defaultOctave);
  if (!match || !Number.isFinite(midi)) return null;
  return {
    letter: match[1].toUpperCase(),
    accidental: match[2].replace('♯', '#').replace('♭', 'b'),
    octave: match[3] === undefined ? Number(defaultOctave) : Number(match[3]),
    midi
  };
}

export function parseNotes(value, defaultOctave = 4) {
  const tokens = Array.isArray(value)
    ? value.map(note => String(note).trim()).filter(Boolean)
    : String(value ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Digite ao menos uma nota, por exemplo C E G.');
  const parsed = tokens.map(note => parseNote(note, defaultOctave));
  const invalid = tokens.filter((_, index) => !Number.isFinite(parsed[index]));
  if (invalid.length) {
    throw new Error(`Não reconheci ${invalid.map(note => `“${note}”`).join(', ')}. Use notas de A a G, sustenido (#), bemol (b) e uma oitava opcional, como C, F#5 ou Bb3.`);
  }
  return parsed;
}

export function formatNote(midi) {
  const pitch = ((midi % 12) + 12) % 12;
  return `${NOTE_NAMES[pitch]} ${Math.floor(midi / 12) - 1}`;
}

function formatPianoNote(midi) {
  const pitch = ((midi % 12) + 12) % 12;
  return `${LETTER_NOTES[pitch]}${Math.floor(midi / 12) - 1}`;
}

function pianoShortcut(midi) {
  const octaveIndex = Math.floor((midi - PIANO_START_MIDI) / 12);
  if (octaveIndex < 0 || octaveIndex > 2 || midi === PIANO_END_MIDI) {
    return midi === PIANO_END_MIDI ? 'Ctrl+C' : '';
  }
  const pitch = ((midi % 12) + 12) % 12;
  const naturalIndex = [0, 2, 4, 5, 7, 9, 11].indexOf(pitch);
  const key = naturalIndex >= 0 ? WHITE_SHORTCUTS[naturalIndex] : BLACK_SHORTCUTS[[1, 3, 6, 8, 10].indexOf(pitch)];
  return octaveIndex ? `Shift+${key}` : key;
}

function getAudioContext() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error('Este navegador não oferece Web Audio para reproduzir o piano.');
  audioContext ||= new Context();
  if (!masterGain) {
    masterGain = audioContext.createGain();
    compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 18;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;
    masterGain.gain.value = volume;
    masterGain.connect(compressor).connect(audioContext.destination);
  }
  return audioContext;
}

function setVolume(value) {
  volume = Math.min(1, Math.max(0, Number(value) / 100));
  if (masterGain && audioContext) masterGain.gain.setTargetAtTime(volume, audioContext.currentTime, 0.025);
}

export async function playNotes(notes, duration = 0.9, defaultOctave = 4, gainScale = 1) {
  const midis = notes.map(note => Number.isFinite(note) ? note : parseNote(note, defaultOctave));
  if (midis.some(note => !Number.isFinite(note))) {
    throw new Error('Uma ou mais notas não são válidas. Revise as notas antes de tocar.');
  }
  if (!midis.length) throw new Error('Selecione ou configure pelo menos uma nota.');
  const context = getAudioContext();
  if (context.state === 'suspended') await context.resume();
  const now = context.currentTime;
  const voiceLevel = Math.min(0.7, 0.2 * Math.max(0, Number(gainScale) || 0) / Math.sqrt(midis.length));
  for (const midi of midis) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(voiceLevel, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }
}

export function pianoMarkup({ id, selected = [], label = 'Piano de C4 até C6', defaultOctave = 4 } = {}) {
  const octaveSpecs = [
    { startMidi: 60, length: 12 },
    { startMidi: 72, length: 12 },
    { startMidi: 84, length: 1 }
  ];
  const octaves = octaveSpecs.map((spec, octaveIndex) => {
    let whiteIndex = 0;
    let keys = '';
    for (let offset = 0; offset < spec.length; offset += 1) {
      const midi = spec.startMidi + offset;
      const pitch = midi % 12;
      const note = formatPianoNote(midi);
      const shortcut = pianoShortcut(midi);
      const isSelected = selected.includes(note);
      if (BLACK_PITCHES.has(pitch)) {
        const previousWhite = whiteIndex - 1;
        const left = ((previousWhite + 1) / 7) * 100;
        keys += `<button class="piano-key black${isSelected ? ' selected' : ''}" type="button" data-note="${note}" data-midi="${midi}" data-shortcut="${shortcut}" aria-label="Tocar ${note}${shortcut ? `, atalho ${shortcut}` : ''}" style="left:calc(${left}% - 4.6%)"><kbd>${shortcut ? shortcut.replace('Shift+', '⇧') : ''}</kbd></button>`;
      } else {
        keys += `<button class="piano-key white${isSelected ? ' selected' : ''}" type="button" data-note="${note}" data-midi="${midi}" data-shortcut="${shortcut}" aria-label="Tocar ${note}, atalho ${shortcut}"><span class="piano-note-label">${note}</span><kbd>${shortcut.replace('Shift+', '⇧')}</kbd></button>`;
        whiteIndex += 1;
      }
    }
    return `<div class="piano-octave${octaveIndex === 2 ? ' piano-octave-final' : ''}" data-piano-octave="${octaveIndex}">${keys}</div>`;
  }).join('');
  return `<section class="piano-panel" data-piano="${id || ''}" tabindex="0" aria-label="${label}"><div class="piano piano-keys">${octaves}</div><div class="piano-footer"><p class="piano-selection" aria-live="polite">Selecione as notas no teclado.</p><div class="piano-actions"><button class="button secondary" type="button" data-piano-action="clear">Limpar notas</button><button class="button secondary" type="button" data-piano-action="play">♫ Ouvir acorde</button></div></div><label class="piano-volume">Volume <input type="range" min="0" max="100" value="${Math.round(volume * 100)}" data-piano-volume aria-label="Volume do piano"><span data-piano-volume-value>${Math.round(volume * 100)}%</span></label><p class="piano-hint">C4–C6. C D E F G A B toca C4–B4; Shift + essas teclas toca C5–B5. Ctrl+C toca C6. As teclas pretas usam 1 2 3 4 5. Clique no piano para ativar os atalhos. Notas digitadas sem oitava usam C${defaultOctave} como padrão.</p></section>`;
}

export function bindPianos(container, { onChange, defaultOctave = 4 } = {}) {
  container.querySelectorAll('[data-piano]').forEach(piano => {
    if (piano.dataset.bound === 'true') return;
    piano.dataset.bound = 'true';
    const selected = new Set([...piano.querySelectorAll('.piano-key.selected')].map(key => key.dataset.note));
    piano.dataset.selected = JSON.stringify([...selected]);
    const volumeInput = piano.querySelector('[data-piano-volume]');
    volumeInput?.addEventListener('input', () => {
      setVolume(volumeInput.value);
      piano.querySelector('[data-piano-volume-value]').textContent = `${volumeInput.value}%`;
    });
    piano.addEventListener('pointerdown', event => {
      if (event.target === piano || event.target.classList.contains('piano')) {
        piano.focus({ preventScroll: true });
      }
    });
    piano.addEventListener('click', async event => {
      const key = event.target.closest('.piano-key');
      const action = event.target.closest('[data-piano-action]')?.dataset.pianoAction;
      if (key) {
        const note = key.dataset.note;
        if (piano.dataset.mode === 'single') {
          selected.clear();
          piano.querySelectorAll('.piano-key').forEach(item => item.classList.remove('selected'));
        }
        if (selected.has(note)) {
          selected.delete(note);
          key.classList.remove('selected');
        } else {
          selected.add(note);
          key.classList.add('selected');
          key.classList.add('pressed');
          window.setTimeout(() => key.classList.remove('pressed'), 180);
          try { await playNotes([Number(key.dataset.midi)], 0.55, defaultOctave); }
          catch (error) { window.dispatchEvent(new CustomEvent('notarium:error', { detail: error.message })); }
        }
        const notes = [...selected];
        piano.querySelector('.piano-selection').textContent = notes.length
          ? `Notas selecionadas: ${notes.map(note => formatPianoNote(parseNote(note))).join(' · ')}`
          : 'Selecione as notas no teclado.';
        piano.dataset.selected = JSON.stringify(notes);
        onChange?.(notes, piano);
      } else if (action === 'clear') {
        selected.clear();
        piano.querySelectorAll('.piano-key').forEach(item => item.classList.remove('selected'));
        piano.querySelector('.piano-selection').textContent = 'Selecione as notas no teclado.';
        piano.dataset.selected = '[]';
        onChange?.([], piano);
      } else if (action === 'play') {
        try { await playNotes([...selected]); }
        catch (error) { window.dispatchEvent(new CustomEvent('notarium:error', { detail: error.message })); }
      }
    });
    piano.addEventListener('keydown', async event => {
      const target = event.target;
      if (target.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.altKey || event.metaKey) return;
      const naturalIndex = WHITE_SHORTCUTS.findIndex(note => event.code === `Key${note}`);
      const blackIndex = BLACK_SHORTCUTS.findIndex((_, index) => event.code === `Digit${index + 1}`);
      const pitch = naturalIndex >= 0 ? [0, 2, 4, 5, 7, 9, 11][naturalIndex]
        : blackIndex >= 0 ? [1, 3, 6, 8, 10][blackIndex]
          : -1;
      let midi = -1;
      if (event.ctrlKey && !event.shiftKey && event.code === 'KeyC') {
        midi = 84;
      } else {
        if (event.ctrlKey || pitch < 0) return;
        midi = PIANO_START_MIDI + (event.shiftKey ? 12 : 0) + pitch;
      }
      const key = piano.querySelector(`.piano-key[data-midi="${midi}"]`);
      if (!key) return;
      event.preventDefault();
      if (event.repeat) return;
      key.classList.add('pressed');
      try { await playNotes([midi], 0.55, defaultOctave); }
      catch (error) { window.dispatchEvent(new CustomEvent('notarium:error', { detail: error.message })); }
      window.setTimeout(() => key.classList.remove('pressed'), 180);
    });
  });
}
