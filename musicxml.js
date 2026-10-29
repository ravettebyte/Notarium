function validateMusicXml(xml) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  if (parsed.querySelector('parsererror') || !parsed.querySelector('score-partwise, score-timewise')) {
    throw new Error('O arquivo não contém uma partitura MusicXML válida.');
  }
  return xml;
}

export function extractRhythmEvents(xml) {
  const parsed = new DOMParser().parseFromString(validateMusicXml(xml), 'application/xml');
  const part = parsed.querySelector('score-partwise part');
  if (!part) throw new Error('Não encontrei uma parte musical para transformar em exercício rítmico.');
  const firstSoundTempo = Number(parsed.querySelector('sound[tempo]')?.getAttribute('tempo'));
  const firstMetronomeTempo = Number(parsed.querySelector('metronome per-minute')?.textContent);
  const tempo = Math.min(240, Math.max(30, firstSoundTempo || firstMetronomeTempo || 80));
  let divisions = 1;
  let beats = 4;
  let beatType = 4;
  let elapsedQuarters = 0;
  const events = [];

  for (const measure of part.querySelectorAll('measure')) {
    let cursor = 0;
    let measureEnd = 0;
    for (const item of measure.children) {
      if (item.localName === 'attributes') {
        const nextDivisions = Number(item.querySelector('divisions')?.textContent);
        if (nextDivisions > 0) divisions = nextDivisions;
        const time = item.querySelector('time');
        const nextBeats = Number(time?.querySelector('beats')?.textContent);
        const nextBeatType = Number(time?.querySelector('beat-type')?.textContent);
        if (nextBeats > 0 && nextBeatType > 0) { beats = nextBeats; beatType = nextBeatType; }
      } else if (item.localName === 'backup' || item.localName === 'forward') {
        const amount = Number(item.querySelector('duration')?.textContent) / divisions;
        if (Number.isFinite(amount)) cursor = Math.max(0, cursor + (item.localName === 'backup' ? -amount : amount));
      } else if (item.localName === 'note') {
        const duration = Number(item.querySelector('duration')?.textContent) / divisions;
        const chordTone = Boolean(item.querySelector('chord'));
        if (!chordTone && !item.querySelector('grace, rest')
            && Number.isFinite(duration) && duration > 0) {
          events.push({
            index: events.length,
            measure: Number(measure.getAttribute('number')) || events.length + 1,
            beat: Number((elapsedQuarters + cursor).toFixed(4)),
            durationBeats: Number(duration.toFixed(4)),
            timeSeconds: Number(((elapsedQuarters + cursor) * 60 / tempo).toFixed(4))
          });
        }
        if (!chordTone && Number.isFinite(duration)) cursor += duration;
      }
      measureEnd = Math.max(measureEnd, cursor);
    }
    elapsedQuarters += Math.max(measureEnd, beats * 4 / beatType);
  }

  if (!events.length) throw new Error('Não encontrei notas tocáveis na partitura para a atividade rítmica.');
  return { tempo, events };
}

export async function readMusicXmlFile(file) {
  if (!file) return '';
  if (file.size > 5_000_000) throw new Error('A partitura deve ter até 5 MB.');
  if (!/\.(xml|musicxml|mxl)$/i.test(file.name)) {
    throw new Error('Selecione um arquivo .xml, .musicxml ou .mxl.');
  }
  if (/\.mxl$/i.test(file.name)) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('A leitura de arquivos .mxl depende da biblioteca JSZip instalada no projeto.');
    const archive = await JSZip.loadAsync(file);
    const container = archive.file('META-INF/container.xml');
    let scorePath = '';
    if (container) {
      const xml = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
      scorePath = xml.querySelector('rootfile')?.getAttribute('full-path') || '';
    }
    const scoreFile = (scorePath && archive.file(scorePath))
      || Object.values(archive.files).find(entry => !entry.dir && /\.(musicxml|xml)$/i.test(entry.name));
    if (!scoreFile) throw new Error('Não encontrei a partitura MusicXML dentro do arquivo .mxl.');
    return validateMusicXml(await scoreFile.async('string'));
  }
  return validateMusicXml(await file.text());
}

export async function readMusicXmlUrl(value) {
  const url = new URL(value, location.href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use um endereço HTTPS ou HTTP para a partitura.');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Não foi possível carregar a partitura pelo link (${response.status}).`);
  if (/\.mxl$/i.test(url.pathname)) {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('A leitura de links .mxl depende da biblioteca JSZip instalada no projeto.');
    const archive = await JSZip.loadAsync(await response.arrayBuffer());
    const container = archive.file('META-INF/container.xml');
    let scorePath = '';
    if (container) {
      const xml = new DOMParser().parseFromString(await container.async('string'), 'application/xml');
      scorePath = xml.querySelector('rootfile')?.getAttribute('full-path') || '';
    }
    const scoreFile = (scorePath && archive.file(scorePath))
      || Object.values(archive.files).find(entry => !entry.dir && /\.(musicxml|xml)$/i.test(entry.name));
    if (!scoreFile) throw new Error('Não encontrei a partitura MusicXML dentro do arquivo .mxl.');
    return validateMusicXml(await scoreFile.async('string'));
  }
  const xml = await response.text();
  if (new TextEncoder().encode(xml).byteLength > 5_000_000) throw new Error('A partitura deve ter até 5 MB.');
  return validateMusicXml(xml);
}

export async function renderMusicXml(xml, container) {
  const OSMD = window.opensheetmusicdisplay?.OpenSheetMusicDisplay;
  if (!OSMD) throw new Error('O renderizador de partituras não foi carregado. Instale as dependências indicadas no README.');
  const renderer = new OSMD(container, { autoResize: true, backend: 'svg', drawTitle: true, followCursor: false });
  await renderer.load(xml);
  renderer.render();
  return renderer;
}
