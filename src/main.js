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
          <button id="play" class="play-button" disabled><span>▶</span><span id="play-label">Lire</span></button>
          <button id="stop" class="icon-button" title="Arrêter" disabled>■</button>
          <label class="tempo-control">Tempo <input id="tempo" type="range" min="40" max="180" value="100" /><output id="tempo-value">100</output></label>
        </div>
      </div>
      <div class="score-frame">
        <div id="empty-state">
          <div class="music-mark">𝄞</div>
          <h2>Votre partition apparaîtra ici</h2>
          <p>Choisissez un fichier MusicXML pour commencer.</p>
        </div>
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
  tempo: document.querySelector("#tempo"),
  tempoValue: document.querySelector("#tempo-value"),
  measureStatus: document.querySelector("#measure-status"),
  toolbar: document.querySelector(".toolbar"),
};

els.score.addEventListener("click", (event) => {
  if (!scoreData || !cursorTimeline.length) return;
  if (isPlaying) stopPlayback();
  const point = cursorTimeline.reduce((closest, candidate) => {
    const distance = Math.hypot(
      event.pageX - candidate.x,
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
  osmd?.cursor.reset();
  osmd?.cursor.show();
  currentCursorPosition = 0;
  setMeasure(0);
});
els.tempo.addEventListener("input", ({ target }) => {
  els.tempoValue.textContent = target.value;
  Tone.Transport.bpm.value = Number(target.value);
});

async function loadScore(xml, name) {
  stopPlayback();
  els.score.innerHTML = "";
  osmd = new OpenSheetMusicDisplay(els.score, {
    autoResize: true,
    drawTitle: true,
    drawingParameters: "default",
    followCursor: false,
    cursorsOptions: [{ type: 0, color: "#d45b46", alpha: 0.32, follow: false }],
  });
  await osmd.load(xml);
  osmd.render();
  osmd.cursor.reset();
  osmd.cursor.show();
  currentCursorPosition = 0;
  scoreData = parseMusicXml(xml);
  cursorTimeline = buildCursorTimeline();
  selectedStartBeat = 0;
  if (scoreData.tempo) {
    const tempo = Math.max(40, Math.min(180, Math.round(scoreData.tempo)));
    els.tempo.value = tempo;
    els.tempoValue.textContent = tempo;
  }
  if (!scoreData.measures.some((measure) => measure.notes.length)) {
    throw new Error("Aucune note jouable trouvée dans le premier instrument");
  }
  els.empty.hidden = true;
  els.fileName.textContent = name;
  [els.play, els.stop, els.rewind].forEach((button) => { button.disabled = false; });
  setMeasure(0);
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
  scoreData.measures.forEach((measure) => {
    measure.notes.forEach((note) => {
      if (note.time + note.duration <= startBeat) return;
      const noteStart = Math.max(note.time, startBeat);
      scheduledEvents.push(Tone.Transport.schedule((time) => {
        piano.triggerAttackRelease(
          Tone.Frequency(note.pitch, "midi"),
          (note.duration - Math.max(0, startBeat - note.time)) * secondsPerBeat,
          time,
        );
      }, startDelay + (noteStart - startBeat) * secondsPerBeat));
    });
    if (measure.start >= startBeat) {
      Tone.Transport.schedule((audioTime) => {
        Tone.Draw.schedule(() => setMeasure(measure.index), audioTime);
      }, startDelay + (measure.start - startBeat) * secondsPerBeat);
    }
  });
  cursorTimeline.filter(({ time }) => time >= startBeat).forEach(({ time, position }) => {
    Tone.Transport.schedule((audioTime) => {
      Tone.Draw.schedule(() => setCursorPosition(position), audioTime);
    }, startDelay + (time - startBeat) * secondsPerBeat);
  });
  Tone.Transport.schedule((audioTime) => {
    Tone.Draw.schedule(() => {
      stopPlayback();
      setMeasure(0);
      setCursorPosition(0);
    }, audioTime);
  }, startDelay + Math.max(0, scoreData.duration - startBeat) * secondsPerBeat);
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
    const initialPosition = cursorTimeline.findIndex(({ time }) => time >= startBeat);
    setCursorPosition(initialPosition < 0 ? 0 : initialPosition);
    schedulePlayback(startBeat);
    Tone.Transport.start();
    setPlaying(true);
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
  Tone.Draw.cancel();
  scheduledEvents = [];
  setPlaying(false);
}

function setPlaying(value) {
  isPlaying = value;
  els.toolbar.classList.toggle("is-floating", value);
  els.playLabel.textContent = value ? "Pause" : "Lire";
  els.play.querySelector("span").textContent = value ? "Ⅱ" : "▶";
}

function setMeasure(index) {
  const total = scoreData?.measures.length || 0;
  els.measureStatus.textContent = total ? `Mesure ${Math.min(index + 1, total)} / ${total}` : "Prêt à jouer";
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
  keepCursorVisible();
}

function keepCursorVisible() {
  const cursorElement = osmd?.cursor?.cursorElement;
  if (!cursorElement) return;
  const bounds = cursorElement.getBoundingClientRect();
  const margin = Math.min(window.innerHeight * 0.25, 180);
  const isOutsideViewport = bounds.top < margin || bounds.bottom > window.innerHeight - margin;
  if (isOutsideViewport) {
    const target = window.scrollY + bounds.top - window.innerHeight * 0.35;
    window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  }
}
