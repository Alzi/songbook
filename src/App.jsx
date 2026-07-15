/*
Version: 0.61
*/
import "./App.css";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { Music, Plus, ArrowLeft, Pencil, Trash2, Play, Pause, ChevronUp, ChevronDown, RotateCcw, Upload } from "lucide-react";

/* ---------------------------------------------------------------
   Musik-Hilfsfunktionen: Akkorde erkennen & transponieren
--------------------------------------------------------------- */
const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function transposeChordPart(part, steps) {
  const m = part.match(/^([A-G])(#|b)?(.*)$/);
  if (!m) return part;
  const [, letter, accidental, rest] = m;
  const useFlat = accidental === "b";
  const root = letter + (accidental || "");
  let idx = SHARP.indexOf(root);
  if (idx === -1) idx = FLAT.indexOf(root);
  if (idx === -1) return part;
  const newIdx = (((idx + steps) % 12) + 12) % 12;
  const scale = useFlat ? FLAT : SHARP;
  return scale[newIdx] + rest;
}

function transposeChord(chord, steps) {
  if (!steps) return chord;
  return chord
    .split("/")
    .map((p) => transposeChordPart(p, steps))
    .join("/");
}

/* ---------------------------------------------------------------
   ChordPro-ähnliches Parsing: [G]Text -> Akkordzeile + Textzeile
--------------------------------------------------------------- */
function parseLine(line) {
  let lyric = "";
  const chords = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "[") {
      const end = line.indexOf("]", i);
      if (end === -1) {
        lyric += line[i];
        i++;
        continue;
      }
      chords.push({ pos: lyric.length, chord: line.slice(i + 1, end) });
      i = end + 1;
    } else {
      lyric += line[i];
      i++;
    }
  }
  return { lyric, chords };
}

function buildChordLine(chords, steps) {
  const arr = [];
  let cursor = 0;
  chords.forEach(({ pos, chord }) => {
    const label = transposeChord(chord, steps);
    const target = Math.max(pos, cursor);
    while (arr.length < target) arr.push(" ");
    for (const ch of label) arr.push(ch);
    cursor = arr.length + 1;
  });
  return arr.join("");
}

function transposeKey(key, steps) {
  if (!key) return key;
  return transposeChord(key.trim(), steps);
}

/* ---------------------------------------------------------------
   Importer: klassisches "Akkordzeile über Textzeile"-Format
   (z. B. von Tabs-Websites) in unser [Akkord]Text-Format wandeln
--------------------------------------------------------------- */

// Erkennt einzelne Akkord-Tokens wie G, Am7, C/B, F#m, Dsus4 ...
const CHORD_TOKEN_RE = /^[A-G](#|b)?(maj|min|m|sus|dim|aug|add)?[0-9]*(\/[A-G](#|b)?)?$/;

// Übliche Abschnittsnamen aus eckigen Klammern ins Deutsche übersetzen.
// Unbekannte Bezeichnungen werden unverändert übernommen.
const SECTION_NAME_MAP = {
  intro: "Intro",
  verse: "Strophe",
  strophe: "Strophe",
  chorus: "Refrain",
  refrain: "Refrain",
  "pre-chorus": "Vorrefrain",
  prechorus: "Vorrefrain",
  bridge: "Bridge",
  outro: "Outro",
  interlude: "Zwischenspiel",
  solo: "Solo",
  hook: "Hook",
};

function translateSectionLabel(label) {
  const m = label.trim().match(/^([A-Za-zÀ-ÿ\- ]+?)\s*(\d*)$/);
  if (!m) return label.trim();
  const [, word, num] = m;
  const key = word.trim().toLowerCase().replace(/\s+/g, "-");
  const translated = SECTION_NAME_MAP[key];
  if (!translated) return label.trim();
  return num ? `${translated} ${num}` : translated;
}

function tokensWithPositions(line) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) tokens.push({ col: m.index, text: m[0] });
  return tokens;
}

// Eine Zeile gilt als reine Akkordzeile, wenn JEDES Wort ein gültiges
// Akkord-Token ist (z. B. "D    G    Em" oder "Am7/G").
function isChordLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") return false;
  const tokens = trimmed.split(/\s+/);
  return tokens.every((t) => CHORD_TOKEN_RE.test(t));
}

// Akkorde einer Akkordzeile spaltengenau in die darunterliegende
// Textzeile einsetzen: aus "E .... E7" / "We'd like to know"
// wird "[E]We'd like to know [E7]..." usw.
function mergeChordAndLyric(chordLine, lyricLine) {
  const tokens = tokensWithPositions(chordLine).sort((a, b) => b.col - a.col);
  let result = lyricLine;
  for (const { col, text } of tokens) {
    if (col > result.length) result = result.padEnd(col, " ");
    result = result.slice(0, col) + `[${text}]` + result.slice(col);
  }
  return result;
}

// Reine Instrumental-Akkordzeile ohne zugehörigen Text: jedes Akkord-Token
// wird einfach in eckige Klammern gesetzt, die Abstände bleiben erhalten.
function chordOnlyLine(chordLine) {
  return chordLine.replace(/\S+/g, (t) => `[${t}]`);
}

const IMPORT_META_RE = /^(Title|Titel|Author|Artist|Interpret|Key|Ton|Capo|Tuning|Stimmung)\s*:\s*(.*)$/i;

function parseImportedChordText(raw) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  // Kopfzeilen wie "Title: ...", "Author: ...", "Key: ...", "Capo: ..." einlesen
  let title = "";
  let artist = "";
  let key = "";
  let capo = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const m = line.match(IMPORT_META_RE);
    if (!m) break;
    const field = m[1].toLowerCase();
    const val = m[2].trim();
    if (field === "title" || field === "titel") title = val;
    else if (field === "author" || field === "artist" || field === "interpret") artist = val;
    else if (field === "key" || field === "ton") key = val;
    else if (field === "capo") capo = val;
    i++;
  }
  if (capo) artist = artist ? `${artist} (Capo: ${capo})` : `Capo: ${capo}`;

  const out = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Abschnittsmarker in eckigen Klammern, z. B. [Chorus] oder [Verse 1]
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      out.push(`## ${translateSectionLabel(sectionMatch[1])}`);
      continue;
    }

    if (trimmed === "") {
      out.push("");
      continue;
    }

    if (isChordLine(line)) {
      const next = lines[i + 1];
      const nextIsUsableLyric =
        next !== undefined && next.trim() !== "" && !isChordLine(next) && !/^\[[^\]]+\]$/.test(next.trim());
      if (nextIsUsableLyric) {
        out.push(mergeChordAndLyric(line, next));
        i++; // Textzeile wurde bereits mit verarbeitet
      } else {
        out.push(chordOnlyLine(line));
      }
      continue;
    }

    // normale Textzeile ohne eigene Akkordzeile darüber
    out.push(line);
  }

  // mehrfache Leerzeilen am Ende entfernen
  while (out.length && out[out.length - 1] === "") out.pop();

  return {
    id: null,
    title: title || "Ohne Titel",
    artist,
    key,
    scrollDelay: 0,
    body: out.join("\n"),
  };
}

/* ---------------------------------------------------------------
   Beispiel-Song (eigene, unverfängliche Demo-Strophen)
--------------------------------------------------------------- */
const DEMO_SONG = {
  id: "demo",
  title: "Leiser Morgen",
  artist: "Beispielsong",
  key: "G",
  body: `## Strophe 1
[G]Der Morgen kommt so [D]leise über die Stadt
[Em]Kaffee in der [C]Hand, der Tag hat noch [G]nichts gehabt
[G]Ich schnür die Schuh und [D]geh hinaus
[Em]vielleicht wird heut ein [C]guter [D]Tag draus

## Refrain
[C]Halt mich fest, [G]lass mich nicht [D]los
[Em]dreh die Welt ein [C]bisschen [G]groß
[C]Halt mich fest, [G]irgendwie [D]weiß ich schon
[Em]heute wird ein [C]guter [D]Ton

## Strophe 2
[G]Die Gitarre wartet [D]schon so lang
[Em]greif in die Saiten, [C]such den ersten [G]Klang
[G]Und was auch immer [D]heut passiert
[Em]diese Zeile [C]hier wird gut [D]transponiert`,
};

/* ---------------------------------------------------------------
   Persistenz
--------------------------------------------------------------- */
// Läuft die App in einem Claude-Artefakt (window.storage vorhanden) oder
// lokal im normalen Browser? Im lokalen Fall wird stattdessen localStorage genutzt.
const hasCloudStorage = typeof window !== "undefined" && !!window.storage;

async function loadSongs() {
  try {
    if (hasCloudStorage) {
      const res = await window.storage.get("songbook:songs", false);
      if (res && res.value) return JSON.parse(res.value);
    } else if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("songbook:songs");
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    /* noch keine Daten vorhanden */
  }
  return null;
}
async function saveSongs(songs) {
  try {
    if (hasCloudStorage) {
      await window.storage.set("songbook:songs", JSON.stringify(songs), false);
    } else if (typeof window !== "undefined") {
      window.localStorage.setItem("songbook:songs", JSON.stringify(songs));
    }
  } catch (e) {
    console.error("Speichern fehlgeschlagen", e);
  }
}

/* ---------------------------------------------------------------
   App
--------------------------------------------------------------- */
export default function Songbook() {
  const [songs, setSongs] = useState(null); // null = wird geladen
  const [view, setView] = useState("library"); // library | edit | perform | import
  const [currentId, setCurrentId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [importDraft, setImportDraft] = useState(null); // frisch importierter, noch nicht gespeicherter Song

  useEffect(() => {
    (async () => {
      const loaded = await loadSongs();
      if (loaded && loaded.length) {
        setSongs(loaded);
      } else {
        setSongs([DEMO_SONG]);
        saveSongs([DEMO_SONG]);
      }
    })();
  }, []);

  const persist = useCallback((next) => {
    setSongs(next);
    saveSongs(next);
  }, []);

  const currentSong = songs?.find((s) => s.id === currentId) || null;

  function openNew() {
    setCurrentId(null);
    setImportDraft(null);
    setView("edit");
  }
  function openImport() {
    setImportDraft(null);
    setView("import");
  }
  function handleImportParsed(parsed) {
    setCurrentId(null);
    setImportDraft(parsed);
    setView("edit");
  }
  function openEdit(id) {
    setCurrentId(id);
    setImportDraft(null);
    setView("edit");
  }
  function openPerform(id) {
    setCurrentId(id);
    setView("perform");
  }
  function backToLibrary() {
    setView("library");
    setCurrentId(null);
    setImportDraft(null);
  }
  function handleSave(song) {
    let next;
    if (song.id) {
      next = songs.map((s) => (s.id === song.id ? song : s));
    } else {
      const withId = { ...song, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) };
      next = [...songs, withId];
    }
    persist(next);
    setImportDraft(null);
    setView("library");
  }
  function handleDelete(id) {
    persist(songs.filter((s) => s.id !== id));
    setConfirmDeleteId(null);
  }
  function updateSongMeta(id, patch) {
    persist(songs.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  return (
    <div className="sb-root">
      <header className="sb-header">
        <div className="sb-brand">
          <Music size={20} strokeWidth={2} />
          <span>Songbook</span>
        </div>
        {view !== "library" && (
          <button className="btn-ghost" onClick={backToLibrary}>
            <ArrowLeft size={16} /> Bibliothek
          </button>
        )}
      </header>

      {songs === null && <div className="sb-loading">Lade Songs …</div>}

      {songs !== null && view === "library" && (
        <Library
          songs={songs}
          onNew={openNew}
          onImport={openImport}
          onOpen={openPerform}
          onEdit={openEdit}
          confirmDeleteId={confirmDeleteId}
          setConfirmDeleteId={setConfirmDeleteId}
          onDelete={handleDelete}
        />
      )}

      {view === "import" && <Importer onParsed={handleImportParsed} onCancel={backToLibrary} />}

      {view === "edit" && <Editor song={currentSong || importDraft} onSave={handleSave} onCancel={backToLibrary} />}

      {view === "perform" && currentSong && (
        <Performer
          song={currentSong}
          onBack={backToLibrary}
          onEdit={() => openEdit(currentSong.id)}
          onSaveSpeed={(spd) => updateSongMeta(currentSong.id, { speed: spd })}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Bibliothek
--------------------------------------------------------------- */
function Library({ songs, onNew, onImport, onOpen, onEdit, confirmDeleteId, setConfirmDeleteId, onDelete }) {
  return (
    <div className="sb-library">
      <div className="sb-library-top">
        <div>
          <h1 className="sb-title">Singen und Gitarre spielen</h1>
          <p className="sb-subtitle">Liederdatenbank mit Begleit-Akkorden. Editieren, Abspielen, Auto-Scroll.</p>
        </div>
        <div className="sb-library-actions">
          <button className="btn-ghost" onClick={onImport}>
            <Upload size={16} /> Song importieren
          </button>
          <button className="btn-gold" onClick={onNew}>
            <Plus size={18} /> Neuer Song
          </button>
        </div>
      </div>

      {songs.length === 0 && <div className="sb-empty">Noch keine Songs. Leg los mit „Neuer Song“.</div>}

      <div className="sb-grid">
        {songs.map((s) => (
          <div key={s.id} className="song-card">
            <button className="song-card-main" onClick={() => onOpen(s.id)}>
              <div className="song-card-title">{s.title || "Ohne Titel"}</div>
              <div className="song-card-meta">
                {s.artist ? s.artist : "Unbekannt"} {s.key ? `· Ton: ${s.key}` : ""}
              </div>
            </button>
            <div className="song-card-actions">
              <button className="icon-btn" title="Bearbeiten" onClick={() => onEdit(s.id)}>
                <Pencil size={15} />
              </button>
              {confirmDeleteId === s.id ? (
                <span className="confirm-row">
                  <button className="confirm-yes" onClick={() => onDelete(s.id)}>
                    Löschen
                  </button>
                  <button className="confirm-no" onClick={() => setConfirmDeleteId(null)}>
                    Abbrechen
                  </button>
                </span>
              ) : (
                <button className="icon-btn" title="Löschen" onClick={() => setConfirmDeleteId(s.id)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Editor
--------------------------------------------------------------- */
function Editor({ song, onSave, onCancel }) {
  const [title, setTitle] = useState(song?.title || "");
  const [artist, setArtist] = useState(song?.artist || "");
  const [key, setKey] = useState(song?.key || "");
  const [scrollDelay, setScrollDelay] = useState(song?.scrollDelay ?? 0);
  const [body, setBody] = useState(song?.body || "");

  function submit(e) {
    e.preventDefault();
    onSave({
      ...song,
      id: song?.id || null,
      title: title.trim() || "Ohne Titel",
      artist: artist.trim(),
      key: key.trim(),
      scrollDelay: Math.max(0, Number(scrollDelay) || 0),
      body,
    });
  }

  return (
    <form className="sb-editor" onSubmit={submit}>
      <div className="field-row">
        <label className="field">
          <span>Titel</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Songtitel" />
        </label>
        <label className="field">
          <span>Interpret</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="optional" />
        </label>
        <label className="field field-small">
          <span>Tonart</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="z. B. G" />
        </label>
        <label className="field field-small">
            type="number"
            min={0}
            step={0.5}
            value={scrollDelay}
            onChange={(e) => setScrollDelay(e.target.value)}
            placeholder="0"
        </label>
      </div>

      <label className="field field-body">
        <span>Text &amp; Akkorde</span>
        <textarea
          className="lyrics-input"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          spellCheck={false}
          placeholder={"[G]Der Morgen kommt so [D]leise über die Stadt\n[Em]Kaffee in der [C]Hand ...\n\n## Refrain\n[C]Halt mich fest ..."}
        />
      </label>

      <div className="editor-hint">
        Akkorde direkt vor der Silbe in eckigen Klammern schreiben, z. B. <code>[G]Text</code>. Zeilen, die mit{" "}
        <code>##</code> beginnen, werden als Abschnitt (z. B. Strophe, Refrain) hervorgehoben. Die
        Scroll-Verzögerung bestimmt, wie viele Sekunden nach dem Start gewartet wird, bevor der Text zu scrollen
        beginnt.
      </div>

      <div className="editor-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="btn-gold">
          Speichern
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------
   Importer: Text im "Akkordzeile über Textzeile"-Format einfügen
--------------------------------------------------------------- */
function Importer({ onParsed, onCancel }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");

  function handleParse(e) {
    e.preventDefault();
    if (!raw.trim()) {
      setError("Bitte zuerst einen Songtext einfügen.");
      return;
    }
    try {
      const parsed = parseImportedChordText(raw);
      onParsed(parsed);
    } catch (err) {
      setError("Der Text konnte nicht gelesen werden. Bitte Format prüfen und erneut versuchen.");
    }
  }

  return (
    <form className="sb-editor" onSubmit={handleParse}>
      <label className="field field-body">
        <span>Songtext einfügen</span>
        <textarea
          className="lyrics-input"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setError("");
          }}
          rows={18}
          spellCheck={false}
          placeholder={
            "Title: Mrs Robinson\nAuthor: Simon & Garfunkel\nKey: A\n\n[Chorus]\nD             G        Em\nAnd here's to you Mrs. Robinson"
          }
        />
      </label>

      {error && <div className="import-error">{error}</div>}

      <div className="editor-hint">
        Erkannt werden: optionale Kopfzeilen <code>Title:</code>, <code>Author:</code>, <code>Key:</code> und{" "}
        <code>Capo:</code>; Abschnitte in eckigen Klammern wie <code>[Chorus]</code> oder <code>[Verse 1]</code>;
        sowie Akkordzeilen, die direkt über der zugehörigen Textzeile stehen — genau wie auf den meisten
        Tabs-Websites üblich. Auf der nächsten Seite lässt sich das Ergebnis noch prüfen und anpassen, bevor
        gespeichert wird.
      </div>

      <div className="editor-actions">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="btn-gold">
          Weiter zum Bearbeiten
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------
   Performer: Scroll-Ansicht mit Transponieren & Tempo
--------------------------------------------------------------- */
function Performer({ song, onBack, onEdit, onSaveSpeed }) {
  const [steps, setSteps] = useState(0);
  const [speed, setSpeed] = useState(song.speed ?? 18); // px/sec
  const [playing, setPlaying] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [tempoSaved, setTempoSaved] = useState(false);
  const [countdown, setCountdown] = useState(null); // Sekunden bis Scroll-Start, oder null

  function handleSaveTempo() {
    onSaveSpeed(speed);
    setTempoSaved(true);
    window.clearTimeout(handleSaveTempo._t);
    handleSaveTempo._t = window.setTimeout(() => setTempoSaved(false), 1600);
  }

  const scrollRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);
  const speedRef = useRef(speed);
  const scrollPosRef = useRef(0); // exakte, nicht gerundete Scroll-Position

  // Aktuelles Tempo immer in einer Ref halten, damit der Scroll-Loop
  // unten sie live lesen kann, ohne dass der Effekt neu gestartet werden muss.
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      setCountdown(null);
      return undefined;
    }

    let cancelled = false;
    let delayTimeout = null;
    let countdownInterval = null;
    const delaySec = Math.max(0, song.scrollDelay || 0);

    function beginScrolling() {
      if (cancelled) return;
      setCountdown(null);
      // Beim Start mit der tatsächlichen aktuellen Position synchronisieren
      // (z. B. falls zwischendurch manuell gescrollt wurde).
      if (scrollRef.current) scrollPosRef.current = scrollRef.current.scrollTop;

      function step(ts) {
        if (lastTsRef.current != null && scrollRef.current) {
          const dt = (ts - lastTsRef.current) / 1000;
          const el = scrollRef.current;
          // Nachkommastellen selbst mitführen statt sie über scrollTop
          // (das der Browser auf ganze Pixel rundet) verloren gehen zu lassen.
          scrollPosRef.current += speedRef.current * dt;
          el.scrollTop = scrollPosRef.current;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
            setPlaying(false);
          }
        }
        lastTsRef.current = ts;
        rafRef.current = requestAnimationFrame(step);
      }
      rafRef.current = requestAnimationFrame(step);
    }

    if (delaySec > 0) {
      const endTime = Date.now() + delaySec * 1000;
      setCountdown(Math.ceil(delaySec));
      countdownInterval = window.setInterval(() => {
        const remaining = Math.max(0, (endTime - Date.now()) / 1000);
        setCountdown(Math.ceil(remaining));
      }, 100);
      delayTimeout = window.setTimeout(beginScrolling, delaySec * 1000);
    } else {
      beginScrolling();
    }

    return () => {
      cancelled = true;
      if (delayTimeout) window.clearTimeout(delayTimeout);
      if (countdownInterval) window.clearInterval(countdownInterval);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
      setCountdown(null);
    };
  }, [playing, song.scrollDelay]);

  useEffect(() => {
    function onKey(e) {
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lines = song.body.split("\n");
  const shownKey = song.key ? transposeKey(song.key, steps) : null;

  return (
    <div className="sb-performer">
      <div className="perform-top">
        <div className="perform-info">
          <h2>{song.title}</h2>
          <div className="perform-meta">
            {song.artist && <span>{song.artist}</span>}
            {shownKey && <span className="key-pill">Ton: {shownKey}</span>}
          </div>
        </div>
        <button className="btn-ghost" onClick={onEdit}>
          <Pencil size={15} /> Bearbeiten
        </button>
      </div>

      <div className="scroll-mask">
        <div className="scroll-area" ref={scrollRef}>
          <div className="scroll-inner" style={{ fontSize: `${fontScale}rem` }}>
            {lines.map((line, i) => {
              if (line.trim() === "") {
                // Über alle folgenden Leerzeilen hinweg die nächste "echte" Zeile suchen.
                let next = i + 1;
                while (next < lines.length && lines[next].trim() === "") next++;

                // Steht danach ein Abschnitts-Titel (##), wird die gesamte Leerzeilen-
                // Gruppe davor beim Rendern übersprungen - unabhängig von ihrer Länge.
                if (lines[next]?.trim().startsWith("##")) return null;
                return <div key={i} className="line-gap" />;
              }
              if (line.trim().startsWith("##")) {
                return (
                  <div key={i} className="section-label">
                    {line.trim().replace(/^##\s*/, "")}
                  </div>
                );
              }
              const { lyric, chords } = parseLine(line);
              const chordLine = buildChordLine(chords, steps);
              return (
                <div key={i} className="song-line">
                  {chordLine.trim() !== "" && <div className="chord-line">{chordLine}</div>}
                  <div className="lyric-line">{lyric || "\u00A0"}</div>
                </div>
              );
            })}
            <div className="scroll-end-space" />
          </div>
        </div>
      </div>

      <div className="pedalboard">
        <div className="pedal-group">
          <button className="pedal-small" onClick={() => setFontScale((f) => Math.max(0.75, f - 0.1))}>
            A−
          </button>
          <button className="pedal-small" onClick={() => setFontScale((f) => Math.min(2, f + 0.1))}>
            A+
          </button>
        </div>

        <div className="pedal-group">
          <button className="pedal-small" onClick={() => setSteps((s) => s - 1)} title="Halbton runter">
            <ChevronDown size={16} />
          </button>
          <div className={"led" + (steps !== 0 ? " led-on" : "")}>
            {steps > 0 ? `+${steps}` : steps}
          </div>
          <button className="pedal-small" onClick={() => setSteps((s) => s + 1)} title="Halbton rauf">
            <ChevronUp size={16} />
          </button>
        </div>

        <div className="pedal-main-wrap">
          <button className="pedal-main" onClick={() => setPlaying((p) => !p)} title="Leertaste = Start/Stopp">
            {playing ? <Pause size={26} /> : <Play size={26} style={{ marginLeft: 3 }} />}
          </button>
          {countdown != null && countdown > 0 && <div className="countdown-badge">Start in {countdown}s</div>}
        </div>

        <div className="pedal-group speed-group">
          <span className="speed-label">Tempo</span>
          <input
            type="range"
            min={4}
            max={100}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <button
            className={"remember-btn" + (tempoSaved ? " remember-btn-done" : "")}
            onClick={handleSaveTempo}
            title="Aktuelles Tempo für diesen Song merken"
          >
            {tempoSaved ? "Gemerkt ✓" : "Tempo merken"}
          </button>
        </div>

        <button
          className="pedal-small"
          title="Zum Anfang"
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
            scrollPosRef.current = 0;
            setPlaying(false);
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={14} /> zur Bibliothek
      </button>
    </div>
  );
}