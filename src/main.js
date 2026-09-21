import * as Tone from "tone";
import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import "./style.css";

const app = document.querySelector("#app");
app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">LECTEUR DE PARTITIONS</p>
        <h1>Faites vivre votre <em>MusicXML</em>.</h1>
        <p class="intro">Importez une partition, écoutez-la et suivez chaque mesure au fil de la lecture.</p>
      </div>
      <label class="dropzone" for="file-input">
        <span class="upload-icon">↑</span>
        <strong>Importer un fichier</strong>
        <span>MusicXML .musicxml ou .xml</span>
        <input id="file-input" type="file" accept=".xml,.musicxml,application/vnd.recordare.musicxml+xml,text/xml" />
      </label>
    </header>

    <section class="workspace">
      <div class="toolbar">
        <div class="file-status">
          <span class="status-dot"></span>
          <span id="file-name">Aucune partition chargée</span>
        </div>
        <div class="controls">
          <button id="rewind" class="icon-button" title="Revenir au début" disabled>↶</button>
          <form id="measure-jump-form" class="measure-control">
            <label for="measure-jump">Mesure</label>
            <input id="measure-jump" type="number" min="1" value="1" disabled />
            <span id="measure-total">/ 0</span>
            <button id="measure-jump-button" type="submit" disabled>Aller</button>
          </form>
          <div class="loop-controls" aria-label="Boucle de lecture">
            <button id="loop-start" type="button" title="Définir le début de la boucle" disabled>Début</button>
            <button id="loop-end" type="button" title="Définir la fin de la boucle" disabled>Fin</button>
            <button id="clear-loop" type="button" title="Supprimer les repères de boucle" disabled>Supprimer la boucle</button>
          </div>
          <button id="play" class="play-button" disabled><span>▶</span><span id="play-label">Lire</span></button>
          <button id="stop" class="icon-button" title="Arrêter" disabled>■</button>
          <label class="mode-control">Mode
            <select id="score-mode">
              <option value="moving-cursor">Suivi classique</option>
              <option value="moving-score">Suivi horizontal</option>
            </select>
          </label>
          <label class="tempo-control">Tempo <input id="tempo" type="range" min="40" max="180" value="100" /><output id="tempo-value">100</output></label>
        </div>
      </div>
      <div class="score-frame">
        <div id="empty-state">
          <div class="music-mark">𝄞</div>
          <h2>Votre partition apparaîtra ici</h2>
          <p>Choisissez un fichier MusicXML pour commencer.</p>
        </div>
        <div id="progress-cursor" aria-hidden="true"></div>
        <div id="loop-start-marker" class="loop-marker loop-start-marker" aria-hidden="true"><span>Début</span></div>
        <div id="loop-end-marker" class="loop-marker loop-end-marker" aria-hidden="true"><span>Fin</span></div>
        <div id="score"></div>
      </div>
    </section>
    <footer><span>Partitura</span><span id="measure-status">Prêt à jouer</span></footer>
  </main>
`;

const els = {
  file: document.querySelector("#file-input"),
  fileName: document.querySelector("#file-name"),
  score: document.querySelector("#score"),
  empty: document.querySelector("#empty-state"),
  play: document.querySelector("#play"),
  playLabel: document.querySelector("#play-label"),
  stop: document.querySelector("#stop"),
  rewind: document.querySelector("#rewind"),
  measureJumpForm: document.querySelector("#measure-jump-form"),
  measureJump: document.querySelector("#measure-jump"),
  measureJumpButton: document.querySelector("#measure-jump-button"),
  measureTotal: document.querySelector("#measure-total"),
  loopStart: document.querySelector("#loop-start"),
  loopEnd: document.querySelector("#loop-end"),
  clearLoop: document.querySelector("#clear-loop"),
  mode: document.querySelector("#score-mode"),
  tempo: document.querySelector("#tempo"),
  tempoValue: document.querySelector("#tempo-value"),
  measureStatus: document.querySelector("#measure-status"),
  toolbar: document.querySelector(".toolbar"),
  scoreFrame: document.querySelector(".score-frame"),
  progressCursor: document.querySelector("#progress-cursor"),
  loopStartMarker: document.querySelector("#loop-start-marker"),
  loopEndMarker: document.querySelector("#loop-end-marker"),
};

const FIXED_CURSOR_RATIO = 0.36;
const FIXED_CURSOR_MIN_LEFT = 92;
const SCORE_MODES = {
  movingScore: "moving-score",
  movingCursor: "moving-cursor",
};

els.score.addEventListener("click", (event) => {
  if (!scoreData || !cursorTimeline.length) return;
  if (isPlaying) stopPlayback();
  const point = cursorTimeline.reduce((closest, candidate) => {
    const distance = Math.hypot(
      event.pageX - (candidate.x + currentScoreOffsetX),
      (event.pageY - candidate.y) * 1.8,
    );
    return distance < closest.distance ? { candidate, distance } : closest;
  }, { candidate: null, distance: Infinity }).candidate;
  if (point) {
    selectedStartBeat = point.time;
    setCursorPosition(point.position);
    const measure = scoreData.measures.find((item) =>
      point.time >= item.start && point.time < item.start + item.length,
    );
    if (measure) setMeasure(measure.index);
  }
});

let osmd;
let scoreData;
let piano;
let pianoReady;
let scheduledEvents = [];
let cursorTimeline = [];
let currentCursorPosition = 0;
let selectedStartBeat = 0;
let isPlaying = false;
let progressAnimationFrame = 0;
let playbackStartBeat = 0;
let playbackStartDelay = 0.1;
let playbackSecondsPerBeat = 0;
let currentScoreOffsetX = 0;
let currentScoreMode = SCORE_MODES.movingCursor;
let loadedScoreXml = "";
let loadedScoreName = "";
let resizeTimer = 0;
let currentMeasureIndex = 0;
let loopStartBeat = null;
let loopEndBeat = null;

els.file.addEventListener("change", async ({ target }) => {
  const file = target.files?.[0];
  if (!file) return;
  try {
    const xml = await file.text();
    await loadScore(xml, file.name);
  } catch (error) {
    els.measureStatus.textContent = "Impossible de lire ce fichier";
    console.error(error);
  }
});

els.play.addEventListener("click", async () => {
  if (!scoreData) return;
  if (isPlaying) {
    Tone.Transport.pause();
    setPlaying(false);
    return;
  }
  await startPlayback(selectedStartBeat);
});

els.stop.addEventListener("click", stopPlayback);
els.rewind.addEventListener("click", () => {
  stopPlayback();
  selectedStartBeat = 0;
  setCursorPosition(0);
  setMeasure(0);
});
els.loopStart.addEventListener("click", () => setLoopPoint("start"));
els.loopEnd.addEventListener("click", () => setLoopPoint("end"));
els.clearLoop.addEventListener("click", clearLoop);
els.measureJumpForm.addEventListener("submit", (event) => {
  event.preventDefault();
  goToMeasure(Number(els.measureJump.value) - 1);
});
els.measureJump.addEventListener("input", ({ target }) => {
  target.value = clampMeasureInput(target.value);
});
els.measureJump.addEventListener("blur", ({ target }) => {
  if (!target.value) target.value = String(currentMeasureIndex + 1);
});
els.tempo.addEventListener("input", ({ target }) => {
  els.tempoValue.textContent = target.value;
  Tone.Transport.bpm.value = Number(target.value);
});

els.mode.addEventListener("change", async ({ target }) => {
  if (isPlaying) {
    target.value = currentScoreMode;
    return;
  }
  currentScoreMode = target.value;
  if (!loadedScoreXml) return;
  els.mode.disabled = true;
  try {
    await renderLoadedScore();
  } finally {
    els.mode.disabled = isPlaying;
  }
});

window.addEventListener("resize", () => {
  if (!scoreData || !cursorTimeline.length || !loadedScoreXml || isPlaying) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderLoadedScore();
  }, 120);
});

async function loadScore(xml, name) {
  stopPlayback();
  loadedScoreXml = xml;
  loadedScoreName = name;
  scoreData = parseMusicXml(xml);
  if (!scoreData.measures.some((measure) => measure.notes.length)) {
    throw new Error("Aucune note jouable trouvée dans le premier instrument");
  }
  if (scoreData.tempo) {
    const tempo = Math.max(40, Math.min(180, Math.round(scoreData.tempo)));
    els.tempo.value = tempo;
    els.tempoValue.textContent = tempo;
  }
  selectedStartBeat = 0;
  clearLoop();
  await renderLoadedScore();
  els.empty.hidden = true;
  els.fileName.textContent = name;
  [els.play, els.stop, els.rewind, els.measureJump, els.measureJumpButton, els.loopStart, els.loopEnd].forEach((control) => {
    control.disabled = false;
  });
  els.measureJump.max = String(scoreData.measures.length);
  els.measureTotal.textContent = `/ ${scoreData.measures.length}`;
  setMeasure(0);
}

async function renderLoadedScore() {
  if (!loadedScoreXml) return;
  els.score.innerHTML = "";
  resetScoreMotion();
  els.scoreFrame.classList.toggle("is-moving-score", currentScoreMode === SCORE_MODES.movingScore);
  osmd = new OpenSheetMusicDisplay(els.score, getOsmdOptions());
  await osmd.load(loadedScoreXml);
  osmd.render();
  osmd.cursor.reset();
  osmd.cursor.show();
  currentCursorPosition = 0;
  cursorTimeline = buildCursorTimeline();
  const position = cursorTimeline.findIndex(({ time }) => time >= selectedStartBeat);
  setCursorPosition(position < 0 ? 0 : position);
  renderProgressCursor(selectedStartBeat);
  renderLoopMarkers();
  els.fileName.textContent = loadedScoreName;
}

function getOsmdOptions() {
  const options = {
    autoResize: false,
    drawTitle: true,
    drawingParameters: "default",
    followCursor: false,
    cursorsOptions: [{ type: 0, color: "#d45b46", alpha: 0, follow: false }],
  };
  if (currentScoreMode === SCORE_MODES.movingCursor) {
    options.autoResize = true;
    return options;
  }
  return {
    ...options,
    newSystemFromNewPageInXML: false,
    newSystemFromXML: false,
    pageFormat: "Endless",
    renderSingleHorizontalStaffline: true,
  };
}

function parseMusicXml(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("XML invalide");
  const parts = [...doc.querySelectorAll("part")];
  const measures = [...(parts[0]?.querySelectorAll(":scope > measure") ?? [])];
  const tempo = Number(
    doc.querySelector("sound[tempo]")?.getAttribute("tempo")
    || doc.querySelector("per-minute")?.textContent,
  ) || null;
  let divisions = 1;
  const events = [];
  const activeTies = new Map();
  let time = 0;
  measures.forEach((measure, index) => {
    const measureEvents = [];
    const measureStart = time;
    let cursor = 0;
    let lastNoteStart = 0;
    let measureLength = 0;
    [...measure.children].forEach((element) => {
      if (element.tagName === "attributes") {
        const nextDivisions = Number(element.querySelector("divisions")?.textContent);
        if (nextDivisions > 0) divisions = nextDivisions;
        return;
      }
      if (element.tagName === "backup" || element.tagName === "forward") {
        const amount = (Number(element.querySelector("duration")?.textContent) || 0) / divisions;
        cursor += element.tagName === "backup" ? -amount : amount;
        if (cursor < 0) cursor = 0;
        return;
      }
      if (element.tagName !== "note") return;

      const duration = (Number(element.querySelector("duration")?.textContent) || divisions) / divisions;
      const start = element.querySelector("chord") ? lastNoteStart : cursor;
      const rest = element.querySelector("rest");
      const pitch = rest ? null : toMidi(element.querySelector("pitch"));
      if (pitch !== null) {
        const absoluteStart = measureStart + start;
        const tieTypes = [...element.querySelectorAll("tie")].map((tie) => tie.getAttribute("type"));
        const tieKey = `${element.querySelector("voice")?.textContent || "1"}:${pitch}`;
        const continuedNote = activeTies.get(tieKey);

        if (continuedNote && tieTypes.includes("stop")) {
          continuedNote.duration += duration;
          if (!tieTypes.includes("start")) activeTies.delete(tieKey);
        } else {
          const noteEvent = { pitch, time: absoluteStart, duration };
          measureEvents.push(noteEvent);
          if (tieTypes.includes("start")) activeTies.set(tieKey, noteEvent);
        }
      }
      lastNoteStart = start;
      if (!element.querySelector("chord")) cursor += duration;
      measureLength = Math.max(measureLength, cursor);
    });
    const length = Math.max(measureLength, 1);
    events.push({ index, start: measureStart, length, notes: measureEvents });
    time += length;
  });
  return { measures: events, duration: time, tempo };
}

function toMidi(pitch) {
  if (!pitch) return null;
  const step = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.querySelector("step")?.textContent];
  const octave = Number(pitch.querySelector("octave")?.textContent);
  if (step === undefined || Number.isNaN(octave)) return null;
  return 12 * (octave + 1) + step + (Number(pitch.querySelector("alter")?.textContent) || 0);
}

function schedulePlayback(startBeat = 0) {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Draw.cancel();
  Tone.Transport.position = 0;
  Tone.Transport.bpm.value = Number(els.tempo.value);
  scheduledEvents = [];
  const secondsPerBeat = 60 / Tone.Transport.bpm.value;
  const startDelay = 0.1;
  const loopEnabled = hasLoop();
  const regionEndBeat = loopEnabled ? loopEndBeat : scoreData.duration;
  const regionStartBeat = loopEnabled ? loopStartBeat : startBeat;
  const playbackDuration = Math.max(0, regionEndBeat - regionStartBeat);

  scoreData.measures.forEach((measure) => {
    measure.notes.forEach((note) => {
      if (note.time + note.duration <= regionStartBeat || note.time >= regionEndBeat) return;
      const noteStart = Math.max(note.time, regionStartBeat);
      const noteEnd = Math.min(note.time + note.duration, regionEndBeat);
      scheduledEvents.push(Tone.Transport.schedule((time) => {
        piano.triggerAttackRelease(
          Tone.Frequency(note.pitch, "midi"),
          (noteEnd - noteStart) * secondsPerBeat,
          time,
        );
      }, startDelay + (noteStart - regionStartBeat) * secondsPerBeat));
    });
    if (measure.start >= regionStartBeat && measure.start < regionEndBeat) {
      Tone.Transport.schedule((audioTime) => {
        Tone.Draw.schedule(() => setMeasure(measure.index), audioTime);
      }, startDelay + (measure.start - regionStartBeat) * secondsPerBeat);
    }
  });
  Tone.Transport.loop = loopEnabled;
  Tone.Transport.loopStart = startDelay;
  Tone.Transport.loopEnd = startDelay + playbackDuration * secondsPerBeat;
  playbackStartBeat = regionStartBeat;
  playbackStartDelay = startDelay;
  playbackSecondsPerBeat = secondsPerBeat;
  if (!loopEnabled) {
    Tone.Transport.schedule((audioTime) => {
      Tone.Draw.schedule(() => {
        stopPlayback();
        selectedStartBeat = 0;
        setMeasure(0);
        setCursorPosition(0);
      }, audioTime);
    }, startDelay + playbackDuration * secondsPerBeat);
  }
}

async function startPlayback(startBeat = 0) {
  if (!scoreData) return;
  try {
    await Tone.start();
    await Tone.getContext().resume();
    if (!piano) {
      els.measureStatus.textContent = "Chargement du son de piano…";
      piano = new Tone.Sampler({
        urls: { C1: "C1.mp3", C2: "C2.mp3", C3: "C3.mp3", C4: "C4.mp3", C5: "C5.mp3", C6: "C6.mp3", C7: "C7.mp3" },
        release: 1.2,
        baseUrl: "https://tonejs.github.io/audio/salamander/",
      }).toDestination();
      pianoReady = Tone.loaded();
    }
    await pianoReady;
    const playbackStart = hasLoop() ? loopStartBeat : startBeat;
    const initialPosition = cursorTimeline.findIndex(({ time }) => time >= playbackStart);
    setCursorPosition(initialPosition < 0 ? 0 : initialPosition);
    schedulePlayback(playbackStart);
    Tone.Transport.start();
    setPlaying(true);
    animateProgressCursor();
  } catch (error) {
    els.measureStatus.textContent = "Le navigateur bloque l’audio";
    console.error("Impossible de démarrer la lecture audio", error);
  }
}

function buildCursorTimeline() {
  if (!osmd?.cursor) return [];
  const timeline = [];
  const seenTimes = new Set();
  const cursor = osmd.cursor;
  cursor.reset();
  currentCursorPosition = 0;
  let position = 0;
  let guard = 0;
  while (!cursor.iterator.EndReached && guard < 10000) {
    // OSMD timestamps are whole-note fractions; MusicXML durations are
    // normalized to quarter-note beats in parseMusicXml().
    const time = cursor.iterator.currentTimeStamp.RealValue * 4;
    const timeKey = time.toFixed(9);
    if (!seenTimes.has(timeKey)) {
      const bounds = cursor.cursorElement?.getBoundingClientRect();
      timeline.push({
        time,
        position,
        x: bounds ? bounds.left + window.scrollX : 0,
        y: bounds ? bounds.top + window.scrollY : 0,
        width: bounds?.width || 2,
        height: bounds?.height || 0,
      });
      seenTimes.add(timeKey);
    }
    cursor.next();
    position += 1;
    guard += 1;
  }
  cursor.reset();
  cursor.show();
  return timeline;
}

function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.loop = false;
  Tone.Draw.cancel();
  scheduledEvents = [];
  setPlaying(false);
}

function setPlaying(value) {
  isPlaying = value;
  if (!value && progressAnimationFrame) {
    cancelAnimationFrame(progressAnimationFrame);
    progressAnimationFrame = 0;
  }
  els.mode.disabled = value;
  els.toolbar.classList.toggle("is-floating", value);
  els.playLabel.textContent = value ? "Pause" : "Lire";
  els.play.querySelector("span").textContent = value ? "Ⅱ" : "▶";
  updateLoopControls();
}

function setMeasure(index) {
  const total = scoreData?.measures.length || 0;
  currentMeasureIndex = total ? Math.max(0, Math.min(index, total - 1)) : 0;
  if (els.measureJump) {
    els.measureJump.value = total ? String(currentMeasureIndex + 1) : "1";
    els.measureJump.max = String(Math.max(total, 1));
  }
  if (els.measureTotal) els.measureTotal.textContent = `/ ${total}`;
  els.measureStatus.textContent = total ? `Mesure ${currentMeasureIndex + 1} / ${total}` : "Prêt à jouer";
}

function goToMeasure(index) {
  if (!scoreData?.measures.length || !cursorTimeline.length) return;
  const measureIndex = Math.max(0, Math.min(index, scoreData.measures.length - 1));
  const measure = scoreData.measures[measureIndex];
  if (isPlaying) stopPlayback();
  selectedStartBeat = measure.start;
  const position = cursorTimeline.findIndex(({ time }) => time >= measure.start);
  setCursorPosition(position < 0 ? cursorTimeline.length - 1 : position);
  setMeasure(measureIndex);
}

function setLoopPoint(point) {
  if (!scoreData) return;
  const beat = selectedStartBeat;

  if (point === "start") {
    loopStartBeat = beat;
    if (loopEndBeat !== null && loopEndBeat <= beat) loopEndBeat = null;
  } else {
    if (loopStartBeat === null) {
      els.measureStatus.textContent = "Définissez d'abord le début de la boucle";
      return;
    }
    const endBeat = cursorTimeline.find(({ time }) => time > beat)?.time ?? scoreData.duration;
    if (endBeat <= loopStartBeat) {
      els.measureStatus.textContent = "La fin doit être après le début de la boucle";
      return;
    }
    loopEndBeat = endBeat;
  }

  updateLoopControls();
}

function clearLoop() {
  loopStartBeat = null;
  loopEndBeat = null;
  updateLoopControls();
}

function hasLoop() {
  return loopStartBeat !== null && loopEndBeat !== null && loopEndBeat > loopStartBeat;
}

function getMeasureNumberAtBeat(beat) {
  const measure = scoreData?.measures.find((item) => beat >= item.start && beat < item.start + item.length);
  return measure ? measure.index + 1 : 1;
}

function updateLoopControls() {
  const startLabel = loopStartBeat === null ? "Début" : `Début M${getMeasureNumberAtBeat(loopStartBeat)}`;
  const endLabel = loopEndBeat === null ? "Fin" : `Fin M${getMeasureNumberAtBeat(Math.max(0, loopEndBeat - 1e-6))}`;
  els.loopStart.textContent = startLabel;
  els.loopEnd.textContent = endLabel;
  els.loopStart.classList.toggle("is-set", loopStartBeat !== null);
  els.loopEnd.classList.toggle("is-set", loopEndBeat !== null);
  const controlsDisabled = !scoreData || isPlaying;
  els.loopStart.disabled = controlsDisabled;
  els.loopEnd.disabled = controlsDisabled;
  els.clearLoop.disabled = controlsDisabled || (loopStartBeat === null && loopEndBeat === null);
  if (hasLoop()) {
    els.measureStatus.textContent = `Boucle : mesures ${getMeasureNumberAtBeat(loopStartBeat)} à ${getMeasureNumberAtBeat(Math.max(0, loopEndBeat - 1e-6))}`;
  }
  renderLoopMarkers();
}

function clampMeasureInput(value) {
  const total = scoreData?.measures.length || 0;
  if (!total || value === "") return "";
  const requestedMeasure = Number(value);
  if (!Number.isFinite(requestedMeasure)) return String(currentMeasureIndex + 1);
  return String(Math.max(1, Math.min(Math.trunc(requestedMeasure), total)));
}

function setCursorPosition(position) {
  if (!osmd?.cursor) return;
  if (position < currentCursorPosition) {
    osmd.cursor.reset();
    currentCursorPosition = 0;
  }
  while (currentCursorPosition < position && !osmd.cursor.iterator.EndReached) {
    osmd.cursor.next();
    currentCursorPosition += 1;
  }
  osmd.cursor.show();
  renderProgressCursor(cursorTimeline[position]?.time ?? 0);
  keepCursorVisible();
}

function animateProgressCursor() {
  if (!isPlaying) return;
  const elapsedSeconds = Math.max(0, Tone.Transport.seconds - playbackStartDelay);
  const loopDuration = hasLoop() ? loopEndBeat - loopStartBeat : 0;
  const currentBeat = hasLoop() && loopDuration > 0
    ? loopStartBeat + (elapsedSeconds / playbackSecondsPerBeat) % loopDuration
    : playbackStartBeat + elapsedSeconds / playbackSecondsPerBeat;
  selectedStartBeat = Math.min(currentBeat, scoreData.duration);
  renderProgressCursor(currentBeat);
  keepProgressCursorVisible();
  progressAnimationFrame = requestAnimationFrame(animateProgressCursor);
}

function renderProgressCursor(time) {
  if (!els.progressCursor || !cursorTimeline.length) return;
  const frameBounds = els.scoreFrame.getBoundingClientRect();
  const frameLeft = frameBounds.left + window.scrollX;
  const frameTop = frameBounds.top + window.scrollY;
  const point = interpolateTimelinePoint(time);

  if (currentScoreMode === SCORE_MODES.movingCursor) {
    resetScoreMotion();
    Object.assign(els.progressCursor.style, {
      transform: `translate(${point.x - frameLeft}px, ${point.y - frameTop}px)`,
      width: `${point.width}px`,
      height: `${point.height}px`,
    });
    renderLoopMarkers();
    return;
  }

  const fixedLeft = Math.min(
    Math.max(FIXED_CURSOR_MIN_LEFT, frameBounds.width * FIXED_CURSOR_RATIO),
    Math.max(FIXED_CURSOR_MIN_LEFT, frameBounds.width - 42),
  );
  currentScoreOffsetX = frameLeft + fixedLeft - point.x;
  els.score.style.transform = `translateX(${currentScoreOffsetX}px)`;

  Object.assign(els.progressCursor.style, {
    transform: `translate(${fixedLeft}px, ${point.y - frameTop}px)`,
    width: `${point.width}px`,
    height: `${point.height}px`,
  });
  renderLoopMarkers();
}

function renderLoopMarkers() {
  if (!els.scoreFrame || !cursorTimeline.length) return;
  const frameBounds = els.scoreFrame.getBoundingClientRect();
  const frameLeft = frameBounds.left + window.scrollX;
  const frameTop = frameBounds.top + window.scrollY;

  [
    [els.loopStartMarker, loopStartBeat],
    [els.loopEndMarker, loopEndBeat],
  ].forEach(([marker, beat]) => {
    if (!marker) return;
    marker.hidden = beat === null;
    if (beat === null) return;

    const point = interpolateTimelinePoint(beat);
    const scoreOffset = currentScoreMode === SCORE_MODES.movingScore ? currentScoreOffsetX : 0;
    Object.assign(marker.style, {
      transform: `translate(${point.x + scoreOffset - frameLeft}px, ${point.y - frameTop}px)`,
      height: `${Math.max(point.height, 36)}px`,
    });
  });
}

function keepCursorVisible() {
  const cursorElement = osmd?.cursor?.cursorElement;
  if (!cursorElement) return;
  const bounds = cursorElement.getBoundingClientRect();
  keepBoundsVisible(bounds);
}

function interpolateTimelinePoint(time) {
  const first = cursorTimeline[0];
  const last = cursorTimeline[cursorTimeline.length - 1];
  let previous = first;
  let next = first;

  if (time >= last.time) {
    previous = last;
    next = last;
  } else {
    next = cursorTimeline.find((point) => point.time >= time) || last;
    previous = cursorTimeline[Math.max(0, cursorTimeline.indexOf(next) - 1)];
  }

  const span = next.time - previous.time;
  const ratio = span > 0 ? Math.max(0, Math.min(1, (time - previous.time) / span)) : 0;

  return {
    x: previous.x + (next.x - previous.x) * ratio,
    y: previous.y + (next.y - previous.y) * ratio,
    width: Math.max(2, previous.width + (next.width - previous.width) * ratio),
    height: previous.height + (next.height - previous.height) * ratio,
  };
}

function resetScoreMotion() {
  currentScoreOffsetX = 0;
  els.score.style.transform = "translateX(0)";
}

function keepProgressCursorVisible() {
  if (!els.progressCursor) return;
  const bounds = els.progressCursor.getBoundingClientRect();
  keepBoundsVisible(bounds);
}

function keepBoundsVisible(bounds) {
  if (!bounds.height) return;
  const margin = Math.min(window.innerHeight * 0.25, 180);
  const isOutsideViewport = bounds.top < margin || bounds.bottom > window.innerHeight - margin;
  if (isOutsideViewport) {
    const target = window.scrollY + bounds.top - window.innerHeight * 0.35;
    window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  }
}
