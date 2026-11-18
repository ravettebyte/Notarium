const NATURAL_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const NOTE_SPELLINGS = [
  ['C', ''], ['C', '#'], ['D', ''], ['D', '#'], ['E', ''],
  ['F', ''], ['F', '#'], ['G', ''], ['G', '#'], ['A', ''], ['A', '#'], ['B', '']
];
export function parseNoteSpelling(value, defaultOctave = 4) {
  if (Number.isFinite(value)) {
    const midi = Math.trunc(value);
    const pitchClass = ((midi % 12) + 12) % 12;
    const [letter, accidental] = NOTE_SPELLINGS[pitchClass];
    return {
      midi,
      letter,
      accidental,
      octave: Math.floor(midi / 12) - 1
    };
  }
  const match = String(value ?? '').trim().match(/^([A-Ga-g])\s*([#♯b♭]?)\s*(-?\d+)?$/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2].replace('♯', '#').replace('♭', 'b');
  const octave = match[3] === undefined ? Number(defaultOctave) : Number(match[3]);
  const alteration = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const midi = (octave + 1) * 12 + NATURAL_SEMITONES[letter] + alteration;
  if (!Number.isInteger(octave) || midi < 0 || midi > 127) return null;
  return { midi, letter, accidental, octave };
}

export function parseNote(value, defaultOctave = 4) {
  return parseNoteSpelling(value, defaultOctave)?.midi ?? Number.NaN;
}

export function parseNotes(value, defaultOctave = 4) {
  const source = Array.isArray(value) ? value : String(value ?? '').trim().split(/[\s,;]+/).filter(Boolean);
  const parsed = source.map(note => parseNote(note, defaultOctave));
  if (parsed.some(note => !Number.isFinite(note))) {
    throw new TypeError('Use notas válidas, como C4 E4 G4.');
  }
  return parsed;
}

export function formatNote(value) {
  if (!Number.isFinite(value) || value < 0 || value > 127) return '';
  const midi = Math.trunc(value);
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function pianoMarkup({ id, defaultOctave = 4 } = {}) {
  const safeId = escapeAttribute(id || 'piano');
  const requestedOctave = Number(defaultOctave);
  const start = Number.isInteger(requestedOctave) ? Math.max(-1, Math.min(8, requestedOctave)) : 4;
  const firstMidi = (start + 1) * 12;
  const octaves = Array.from({ length: 3 }, (_, octaveIndex) => {
    const octaveStart = firstMidi + octaveIndex * 12;
    const finalOctave = octaveIndex === 2;
    const whiteKeys = (finalOctave ? [0, 2] : [0, 2, 4, 5, 7, 9, 11])
      .filter(offset => octaveStart + offset <= 127)
      .map(offset => {
      const midi = octaveStart + offset;
      return `<button type="button" class="piano-key white" data-note="${midi}" aria-label="${formatNote(midi)}" aria-pressed="false" title="${formatNote(midi)}"><span class="piano-note-label">${formatNote(midi).replace(/-?\d+$/, '')}</span></button>`;
    }).join('');
    const blackOffsets = finalOctave ? [[1, 1]] : [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]];
    const blackKeys = blackOffsets.filter(([offset]) => octaveStart + offset <= 127).map(([offset, position]) => {
      const midi = octaveStart + offset;
      return `<button type="button" class="piano-key black" style="left:calc(100% / 7 * ${position} - 4.6%)" data-note="${midi}" aria-label="${formatNote(midi)}" aria-pressed="false" title="${formatNote(midi)}"><span class="piano-note-label">${formatNote(midi).replace(/-?\d+$/, '')}</span></button>`;
    }).join('');
    if (!whiteKeys) return '';
    return `<div class="piano-octave${finalOctave ? ' piano-octave-final' : ''}">${whiteKeys}${blackKeys}</div>`;
  }).join('');
  return `<div class="piano-panel"><div class="piano" data-piano="${safeId}" data-selected="[]" role="group" aria-label="Piano virtual">${octaves}</div><div class="piano-footer"><p class="piano-selection" data-piano-selection>Selecione notas para montar o acorde.</p><div class="piano-actions"><button class="button secondary small-button" type="button" data-piano-action="play" disabled>♫ Ouvir seleção</button><button class="button secondary small-button" type="button" data-piano-action="clear">Limpar notas</button></div></div><p class="piano-hint">Selecione as teclas para montar o acorde.</p></div>`;
}

export function bindPianos(container, { onChange = () => {}, defaultOctave = 4 } = {}) {
  const handleClick = event => {
    const panel = event.target.closest('.piano-panel');
    const piano = panel?.querySelector('[data-piano]');
    if (!piano || !panel || !container.contains(piano)) return;
    const action = event.target.closest('[data-piano-action]')?.dataset.pianoAction;
    const key = event.target.closest('[data-note]');
    if (!action && !key) return;

    const selected = JSON.parse(piano.dataset.selected || '[]');
    if (action === 'clear') selected.length = 0;
    if (key) {
      const midi = Number(key.dataset.note);
      if (selected.includes(midi)) selected.splice(selected.indexOf(midi), 1);
      else selected.push(midi);
    }
    if (action === 'play') {
      playNotes(selected).catch(error => {
        const hint = panel.querySelector('.piano-hint');
        if (hint) hint.textContent = error.message;
      });
      return;
    }
    if (key) {
      playNotes([Number(key.dataset.note)], 0.38, 4, 0.28).catch(error => {
        const hint = panel.querySelector('.piano-hint');
        if (hint) hint.textContent = error.message;
      });
    }
    piano.dataset.selected = JSON.stringify(selected);
    piano.querySelectorAll('[data-note]').forEach(button => {
      const active = selected.includes(Number(button.dataset.note));
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const selection = panel.querySelector('[data-piano-selection]');
    if (selection) selection.textContent = selected.length
      ? selected.map(formatNote).join(' · ')
      : 'Selecione notas para montar o acorde.';
    const playButton = panel.querySelector('[data-piano-action="play"]');
    if (playButton) playButton.disabled = selected.length === 0;
    onChange(selected, piano);
  };
  container.addEventListener('click', handleClick);
  container.querySelectorAll('[data-piano]').forEach(piano => {
    piano.dataset.defaultOctave = String(defaultOctave);
  });
  return () => container.removeEventListener('click', handleClick);
}

export async function playNotes(notes, duration = 0.9, defaultOctave = 4, volume = 0.35) {
  if (!Array.isArray(notes) || !notes.length) throw new TypeError('Selecione pelo menos uma nota para tocar.');
  const midiNotes = notes.map(note => Number.isFinite(note) ? note : parseNote(note, defaultOctave));
  if (midiNotes.some(note => !Number.isInteger(note) || note < 0 || note > 127)) {
    throw new TypeError('Uma ou mais notas não são válidas.');
  }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Este navegador não oferece suporte à reprodução de áudio.');

  const context = new AudioContextConstructor();
  try {
    await context.resume();
    const start = context.currentTime;
    const stop = start + Math.max(0.08, Math.min(8, Number(duration) || 0.9));
    const gain = context.createGain();
    gain.gain.setValueAtTime(Math.max(0, Math.min(1, Number(volume) || 0.35)), start);
    gain.connect(context.destination);
    for (const midi of midiNotes) {
      const oscillator = context.createOscillator();
      const voiceGain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      voiceGain.gain.setValueAtTime(0.0001, start);
      voiceGain.gain.linearRampToValueAtTime(0.18, start + 0.025);
      voiceGain.gain.setValueAtTime(0.18, Math.max(start + 0.03, stop - 0.04));
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, stop);
      oscillator.connect(voiceGain).connect(gain);
      oscillator.start(start);
      oscillator.stop(stop + 0.01);
    }
    await new Promise(resolve => setTimeout(resolve, (stop - start) * 1000 + 30));
  } finally {
    await context.close();
  }
}

export async function playNoteSequence(events, tempo = 100, volume = 0.3) {
  if (!Array.isArray(events) || !events.length) throw new TypeError('A partitura não contém notas para reproduzir.');
  const notes = events.flatMap(event => event.notes || []);
  if (notes.length > 3000 || notes.some(note => !Number.isInteger(note) || note < 0 || note > 127)) {
    throw new TypeError('A partitura contém notas demais ou dados de áudio inválidos.');
  }
  const bpm = Math.max(30, Math.min(240, Number(tempo) || 100));
  const endBeat = Math.max(...events.map(event => Number(event.startBeats) + Number(event.durationBeats)));
  const totalSeconds = endBeat * 60 / bpm;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0 || totalSeconds > 180) {
    throw new TypeError('A duração da partitura precisa ser de até 3 minutos.');
  }
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error('Este navegador não oferece suporte à reprodução de áudio.');

  const context = new AudioContextConstructor();
  try {
    await context.resume();
    const start = context.currentTime + 0.04;
    const master = context.createGain();
    master.gain.setValueAtTime(Math.max(0, Math.min(1, Number(volume) || 0.3)), start);
    master.connect(context.destination);
    for (const event of events) {
      const eventStart = start + Number(event.startBeats) * 60 / bpm;
      const duration = Math.max(0.07, Number(event.durationBeats) * 60 / bpm * 0.9);
      for (const midi of event.notes) {
        const oscillator = context.createOscillator();
        const voiceGain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
        voiceGain.gain.setValueAtTime(0.0001, eventStart);
        voiceGain.gain.linearRampToValueAtTime(0.16, eventStart + 0.02);
        voiceGain.gain.setValueAtTime(0.16, Math.max(eventStart + 0.03, eventStart + duration - 0.04));
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, eventStart + duration);
        oscillator.connect(voiceGain).connect(master);
        oscillator.start(eventStart);
        oscillator.stop(eventStart + duration + 0.01);
      }
    }
    await new Promise(resolve => setTimeout(resolve, (totalSeconds + 0.08) * 1000));
  } finally {
    await context.close();
  }
}
