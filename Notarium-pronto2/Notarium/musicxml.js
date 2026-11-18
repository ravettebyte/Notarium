const NOTE_STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const NOTE_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

async function readZipEntry(bytes, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error('O arquivo MXL está corrompido.');
  if (entry.flags & 1) throw new Error('O arquivo MXL está protegido por senha.');
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.uncompressedSize > 20 * 1024 * 1024) throw new Error('A partitura descompactada excede o limite de 20 MB.');
  if (entry.compression === 0) return compressed;
  if (entry.compression !== 8) throw new Error('O arquivo MXL usa um método de compactação não compatível.');
  if (typeof DecompressionStream !== 'function') {
    throw new Error('Este navegador não oferece suporte para abrir arquivos MXL compactados.');
  }
  let decompressor;
  try {
    decompressor = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('Este navegador não oferece suporte para abrir arquivos MXL compactados.');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(decompressor);
  const expanded = new Uint8Array(await new Response(stream).arrayBuffer());
  if (expanded.byteLength !== entry.uncompressedSize) throw new Error('O conteúdo do arquivo MXL está incompleto.');
  return expanded;
}

async function readMxl(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('O arquivo MXL não contém um índice ZIP válido.');

  const entries = new Map();
  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('O índice do arquivo MXL está corrompido.');
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    entries.set(name, { flags, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  let scorePath = '';
  const container = entries.get('META-INF/container.xml');
  if (container) {
    const containerBytes = await readZipEntry(bytes, container);
    const containerXml = new DOMParser().parseFromString(decoder.decode(containerBytes), 'application/xml');
    scorePath = [...containerXml.getElementsByTagName('*')]
      .find(element => element.localName === 'rootfile')?.getAttribute('full-path') || '';
  }
  const scoreEntry = entries.get(scorePath)
    || [...entries.entries()].find(([name]) => /\.musicxml$|\.xml$/i.test(name) && !/^META-INF\//i.test(name))?.[1];
  if (!scoreEntry) throw new Error('O arquivo MXL não informa onde encontrar a partitura MusicXML.');
  return decoder.decode(await readZipEntry(bytes, scoreEntry));
}

function parseXml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new TypeError('O arquivo MusicXML está vazio.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('O arquivo não contém uma partitura MusicXML válida.');
  if (!['score-partwise', 'score-timewise'].includes(document.documentElement.localName)) {
    throw new Error('O arquivo não contém uma partitura MusicXML compatível.');
  }
  return document;
}

export async function readMusicXmlFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('Selecione um arquivo MusicXML válido.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const xml = isZip || /\.mxl$/i.test(file.name || '')
    ? await readMxl(bytes)
    : new TextDecoder('utf-8').decode(bytes);
  parseXml(xml);
  return xml;
}

export async function readMusicXmlUrl(url) {
  let parsed;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    throw new TypeError('O endereço da partitura não é válido.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError('O endereço da partitura precisa usar HTTP ou HTTPS.');
  const response = await fetch(parsed.href);
  if (!response.ok) throw new Error(`Não foi possível carregar a partitura (${response.status}).`);
  const blob = await response.blob();
  const fileName = decodeURIComponent(parsed.pathname.split('/').pop() || 'partitura.xml');
  return readMusicXmlFile(new File([blob], fileName, { type: blob.type }));
}

function children(element, name) {
  return element ? [...element.children].filter(child => child.localName === name) : [];
}

function firstChild(element, name) {
  return children(element, name)[0] || null;
}

function measureSources(document) {
  const root = document.documentElement;
  if (root.localName === 'score-timewise') {
    const measures = children(root, 'measure');
    const firstMeasure = measures[0];
    const firstPartId = firstChild(firstMeasure, 'part')?.getAttribute('id');
    return measures.map(measure => {
      const parts = children(measure, 'part');
      const source = parts.find(part => !firstPartId || part.getAttribute('id') === firstPartId);
      return { measure, source };
    }).filter(item => item.source);
  }
  const firstPart = firstChild(root, 'part');
  return firstPart
    ? children(firstPart, 'measure').map(measure => ({ measure, source: measure }))
    : [];
}

function readPitch(note) {
  const pitch = firstChild(note, 'pitch');
  if (!pitch) return null;
  const step = firstChild(pitch, 'step')?.textContent?.trim().toUpperCase();
  const octave = Number(firstChild(pitch, 'octave')?.textContent);
  const alter = Number(firstChild(pitch, 'alter')?.textContent || 0);
  if (!(step in NOTE_STEPS) || !Number.isInteger(octave)) return null;
  return { step: NOTE_STEPS[step], octave, alter };
}

export function extractRhythmEvents(xml) {
  const document = parseXml(xml);
  const events = [];
  let divisions = 1;
  for (const { measure, source } of measureSources(document)) {
    const attributes = firstChild(source, 'attributes') || firstChild(measure, 'attributes');
    const declared = Number(firstChild(attributes || measure, 'divisions')?.textContent);
    if (Number.isFinite(declared) && declared > 0) divisions = declared;
    const measureEvents = new Map();
    let cursor = 0;
    for (const element of source.children) {
      if (['backup', 'forward'].includes(element.localName)) {
        const duration = Number(firstChild(element, 'duration')?.textContent);
        const beats = Number.isFinite(duration) && duration > 0 ? duration / divisions : 0;
        cursor = element.localName === 'backup' ? Math.max(0, cursor - beats) : cursor + beats;
      } else if (element.localName === 'note' && !firstChild(element, 'grace')) {
        const duration = Number(firstChild(element, 'duration')?.textContent);
        const durationBeats = Number.isFinite(duration) && duration > 0 ? duration / divisions : 1;
        const chord = Boolean(firstChild(element, 'chord'));
        const start = chord ? Math.max(0, cursor - durationBeats) : cursor;
        const pitch = readPitch(element);
        const key = start.toFixed(4);
        const prior = measureEvents.get(key);
        const event = {
          durationBeats: Math.max(0.125, Math.min(16, durationBeats)),
          pitch: pitch?.step ?? 3,
          octave: pitch?.octave ?? 4,
          alter: pitch?.alter ?? 0,
          rest: Boolean(firstChild(element, 'rest'))
        };
        if (prior) {
          prior.durationBeats = Math.max(prior.durationBeats, event.durationBeats);
          prior.rest = prior.rest && event.rest;
        } else {
          measureEvents.set(key, event);
        }
        if (!chord) cursor += durationBeats;
      }
    }
    events.push(...[...measureEvents.entries()]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([, event]) => event));
  }
  if (!events.length) throw new Error('A partitura não contém notas ou pausas rítmicas.');
  return events;
}

export function extractPlaybackEvents(xml) {
  const document = parseXml(xml);
  const tempoNode = [...document.getElementsByTagName('*')].find(element =>
    element.localName === 'sound' && Number(element.getAttribute('tempo')) > 0);
  const metronomeNode = [...document.getElementsByTagName('*')].find(element => element.localName === 'metronome');
  const tempo = Math.max(30, Math.min(240,
    Number(tempoNode?.getAttribute('tempo'))
      || Number(firstChild(metronomeNode, 'per-minute')?.textContent)
      || 100));
  const events = [];
  let measureOffset = 0;
  let divisions = 1;
  for (const { measure, source } of measureSources(document)) {
    const attributes = firstChild(source, 'attributes') || firstChild(measure, 'attributes');
    const declared = Number(firstChild(attributes || measure, 'divisions')?.textContent);
    if (Number.isFinite(declared) && declared > 0) divisions = declared;
    const measureEvents = new Map();
    let cursor = 0;
    let measureLength = 0;
    for (const element of source.children) {
      if (['backup', 'forward'].includes(element.localName)) {
        const duration = Number(firstChild(element, 'duration')?.textContent);
        const beats = Number.isFinite(duration) && duration > 0 ? duration / divisions : 0;
        cursor = element.localName === 'backup' ? Math.max(0, cursor - beats) : cursor + beats;
        measureLength = Math.max(measureLength, cursor);
      } else if (element.localName === 'note' && !firstChild(element, 'grace')) {
        const duration = Number(firstChild(element, 'duration')?.textContent);
        const durationBeats = Number.isFinite(duration) && duration > 0 ? duration / divisions : 1;
        const chord = Boolean(firstChild(element, 'chord'));
        const start = chord ? Math.max(0, cursor - durationBeats) : cursor;
        const pitch = readPitch(element);
        if (pitch) {
          const key = start.toFixed(4);
          const event = measureEvents.get(key) || {
            startBeats: measureOffset + start,
            durationBeats: Math.max(0.125, Math.min(16, durationBeats)),
            notes: []
          };
          const midi = (pitch.octave + 1) * 12 + NOTE_SEMITONES[pitch.step] + pitch.alter;
          if (Number.isInteger(midi) && midi >= 0 && midi <= 127) event.notes.push(midi);
          event.durationBeats = Math.max(event.durationBeats, durationBeats);
          measureEvents.set(key, event);
        }
        if (!chord) {
          cursor += durationBeats;
          measureLength = Math.max(measureLength, cursor);
        }
      }
    }
    events.push(...measureEvents.values());
    measureOffset += Math.max(measureLength, 1);
  }
  const playable = events.filter(event => event.notes.length).sort((left, right) => left.startBeats - right.startBeats);
  if (!playable.length) throw new Error('A partitura não contém notas que possam ser reproduzidas.');
  if (playable.some(event => (event.startBeats + event.durationBeats) * 60 / tempo > 180)) {
    throw new Error('A partitura é longa demais para ser reproduzida de uma só vez (limite: 3 minutos).');
  }
  return { events: playable, tempo };
}

function noteY(note) {
  const pitch = firstChild(note, 'pitch');
  const stepName = firstChild(pitch || note, 'step')?.textContent?.trim().toUpperCase();
  const octave = Number(firstChild(pitch || note, 'octave')?.textContent);
  if (!(stepName in NOTE_STEPS) || !Number.isInteger(octave)) return 0;
  const diatonic = octave * 7 + NOTE_STEPS[stepName];
  return 120 - (diatonic - (4 * 7 + NOTE_STEPS.E)) * 5;
}

export async function renderMusicXml(xml, container) {
  if (!(container instanceof Element)) throw new TypeError('Não foi possível encontrar a área da partitura.');
  const document = parseXml(xml);
  const measures = measureSources(document);
  const width = Math.max(360, measures.length * 180 + 24);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} 180`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Partitura musical');
  svg.classList.add('musicxml-score');

  for (let line = 0; line < 5; line++) {
    const element = document.createElementNS(svg.namespaceURI, 'line');
    const y = 55 + line * 10;
    element.setAttribute('x1', '12');
    element.setAttribute('x2', String(width - 12));
    element.setAttribute('y1', String(y));
    element.setAttribute('y2', String(y));
    element.setAttribute('stroke', 'currentColor');
    element.setAttribute('stroke-width', '1');
    svg.append(element);
  }

  measures.forEach(({ source }, measureIndex) => {
    const notes = children(source, 'note');
    const startX = 36 + measureIndex * 180;
    const spacing = 140 / Math.max(1, notes.length);
    notes.forEach((note, noteIndex) => {
      const x = startX + noteIndex * spacing;
      const y = firstChild(note, 'rest') ? 76 : noteY(note);
      if (firstChild(note, 'rest')) {
        const rest = document.createElementNS(svg.namespaceURI, 'text');
        rest.setAttribute('x', String(x));
        rest.setAttribute('y', String(y + 7));
        rest.setAttribute('font-size', '21');
        rest.setAttribute('fill', 'currentColor');
        rest.textContent = '𝄽';
        svg.append(rest);
      } else {
        const head = document.createElementNS(svg.namespaceURI, 'ellipse');
        head.setAttribute('cx', String(x));
        head.setAttribute('cy', String(y));
        head.setAttribute('rx', '6');
        head.setAttribute('ry', '4');
        head.setAttribute('transform', `rotate(-20 ${x} ${y})`);
        head.setAttribute('fill', 'currentColor');
        svg.append(head);
        const stem = document.createElementNS(svg.namespaceURI, 'line');
        stem.setAttribute('x1', String(x + 5));
        stem.setAttribute('x2', String(x + 5));
        stem.setAttribute('y1', String(y));
        stem.setAttribute('y2', String(y - 34));
        stem.setAttribute('stroke', 'currentColor');
        stem.setAttribute('stroke-width', '1.5');
        svg.append(stem);
        const alteration = Number(firstChild(firstChild(note, 'pitch') || note, 'alter')?.textContent || 0);
        if (alteration) {
          const accidental = document.createElementNS(svg.namespaceURI, 'text');
          accidental.setAttribute('x', String(x - 13));
          accidental.setAttribute('y', String(y + 5));
          accidental.setAttribute('font-size', '14');
          accidental.setAttribute('fill', 'currentColor');
          accidental.textContent = alteration > 0 ? '♯' : '♭';
          svg.append(accidental);
        }
      }
    });
  });
  container.replaceChildren(svg);
  return svg;
}
