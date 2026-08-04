/*
Version: 0.8
*/
import "./App.css";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import { Music, Plus, ArrowLeft, Pencil, Trash2, Play, Pause, ChevronUp, ChevronDown, RotateCcw, Upload, LogOut } from "lucide-react";

/* ---------------------------------------------------------------
   Supabase-Client (Browser, anon key + RLS statt service_role)
--------------------------------------------------------------- */
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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
   Beispiel-Song
--------------------------------------------------------------- */
const DEMO_SONG = {
  title: "You've got a friend",
  artist: "Carole King",
  key: "G",
  body: `## Intro
[G/C] [C] [D] [Gsus4] [G] [F#m7] [B7]

## Verse1
When you're [Em]down and [B7]troubled and you [Em]need some [B7]loving [Em]care,
and [Am7]nothing, oh, [D7sus4]nothing is going [G]right, [Gsus4] [G]
[F#m7]close your eyes and [B7]think of me and [Em]soon I [B7]will be [Em]there [Em7]
to [Am7]brighten up, woah [B7]even your darkest night. [D7sus4] [D7] [Dsus2] [D7]

## Chorus
Your just [G]call out my [Gmaj7]name, and you [C]know wherever I [Am7]am,
I'll come [G]running [Gmaj7] to see you again [D7sus4] [D7] [Dsus2] [D7]
[G]Winter, spring summer or [Gmaj7]fall, [C]all you got to do is [Em]call
and I'll [C]be there, [Bm7]yeah, [Am7]yeah, yeah. [D7sus4]
You've got a [G]friend

## Zwischenspiel
[G/C] [C] [D] [Gsus4] [G] [F#m7] [B7]

## Verse 2
If the [Em]sky [B7]above you should grow [Em]dark and [B7]full of [Em]clouds,
and that [Am7]old north [D7sus4]wind should begin to [G]blow,
[F#m7]keep your head [B7]together and [Em]call my [B7]name out [Em7]loud now baby
[Am]Soon I'll be [Bm7]knocking upon your [D7sus4]door. [D7] [Dsus2] [D7]

## Chorus
Your just [G]call out my [Gmaj7]name, and you [C]know wherever I [Am7]am,
I'll come [G]running [Gmaj7] to see you again [D7sus4] [D7] [Dsus2] [D7]
[G]Winter, spring summer or [Gmaj7]fall, [C]all you got to do is [Em]call
and I'll [C]be there, [Bm7]yeah, [Am7]yeah, yeah. [D7sus4]

## Bridge
Tell me [F]ain't it good to know that [C]you've got a friend when
[G]people can be so [Gmaj7]cold. They'll [C]hurt you and [Fmaj7]desert you.
they'll [Em]take your soul if you [A7]let them.
But [Dsus4]don't you let them.[D7]

## Chorus
You just [G]call out my [Gmaj7]name, and you [C]know know wherever I [Am7]am,
I'll come [G]running running [Gmaj7]yeah yeah yeah to see you again [D7sus4] [D7] [Dsus2] [D7]
[G]Winter, spring summer or [Gmaj7]fall, now [C]all you got to do is [Em]call
and I'll [C]be there, [Bm7]yeah, [Am7]yeah, yeah now. [D7sus4]
You've got a [G]friend. [C]  [D]You've got a [G]friend.
Ain't it good to [C]know that [D]you've got a [G]friend?
Ain't it good to know,[C] ain't it good to [D] know
ain't it [G]good to know yeah, yeah, yeah. [D7sus4]
You've got a [G]friend.`,
};

/* ---------------------------------------------------------------
   Persistenz: direkter Supabase-Zugriff (anon key + RLS),
   je Operation ein atomarer Request statt "alles löschen, alles
   neu einfügen".
--------------------------------------------------------------- */
async function loadSongs() {
  const { data, error } = await supabase.from("songs").select("*").order("title");
  if (error) {
    console.error("Laden fehlgeschlagen", error);
    return null;
  }
  return data;
}

async function insertSong(song) {
  // id/created_at überlässt du der DB (gen_random_uuid() / default now())
  const { id, ...rest } = song;
  const { data, error } = await supabase.from("songs").insert(rest).select().single();
  if (error) throw error;
  return data;
}

async function updateSong(id, patch) {
  const { data, error } = await supabase.from("songs").update(patch).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

async function deleteSongRemote(id) {
  const { error } = await supabase.from("songs").delete().eq("id", id);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   App
--------------------------------------------------------------- */
export default function Songbook() {
  const [session, setSession] = useState(undefined); // undefined = wird geprüft, null = ausgeloggt
  const [songs, setSongs] = useState(null); // null = wird geladen
  const [view, setView] = useState("library"); // library | edit | perform | import
  const [currentId, setCurrentId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [performChromeHidden, setPerformChromeHidden] = useState(false);
  const [importDraft, setImportDraft] = useState(null); // frisch importierter, noch nicht gespeicherter Song

  // Login-Status prüfen & auf Änderungen (Login/Logout) reagieren
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (!sess) setSongs(null); // beim Ausloggen Songliste zurücksetzen
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Sobald eingeloggt: Songs laden (und beim allerersten Mal einen Demo-Song anlegen)
  useEffect(() => {
    if (!session) return;
    (async () => {
      const loaded = await loadSongs();
      if (loaded && loaded.length) {
        setSongs(loaded);
      } else if (loaded) {
        const created = await insertSong(DEMO_SONG);
        setSongs([created]);
      } else {
        setSongs([]);
      }
    })();
  }, [session]);

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
    setPerformChromeHidden(false);
    setView("perform");
  }
  function backToLibrary() {
    setView("library");
    setCurrentId(null);
    setImportDraft(null);
    setPerformChromeHidden(false);
  }
  async function handleSave(song) {
    try {
      if (song.id) {
        const { id, ...patch } = song;
        const updated = await updateSong(id, patch);
        setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const { id, ...rest } = song;
        const created = await insertSong(rest);
        setSongs((prev) => [...prev, created]);
      }
      setImportDraft(null);
      setView("library");
    } catch (e) {
      console.error("Speichern fehlgeschlagen", e);
      window.alert("Speichern ist fehlgeschlagen. Bitte erneut versuchen.");
    }
  }
  async function handleDelete(id) {
    try {
      await deleteSongRemote(id);
      setSongs((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error("Löschen fehlgeschlagen", e);
      window.alert("Löschen ist fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setConfirmDeleteId(null);
    }
  }
  async function updateSongMeta(id, patch) {
    // optimistisch lokal aktualisieren, damit z. B. "Tempo merken" sofort reagiert
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    try {
      await updateSong(id, patch);
    } catch (e) {
      console.error("Aktualisieren fehlgeschlagen", e);
    }
  }
  async function handleLogout() {
    await supabase.auth.signOut();
    backToLibrary();
  }

  if (session === undefined) {
    return (
      <div className="sb-root">
        <div className="sb-loading">Lade …</div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="sb-root">
        <header className="sb-header">
          <div className="sb-brand">
            <Music size={20} strokeWidth={2} />
            <span>Songbook</span>
          </div>
        </header>
        <Login />
      </div>
    );
  }

  return (
    <div className="sb-root">
      <header className={"sb-header" + (view === "perform" && performChromeHidden ? " sb-header-hidden" : "")}>
        <div className="sb-brand">
          <Music size={20} strokeWidth={2} />
          <span>Songbook</span>
        </div>
        {view !== "library" ? (
          <button className="btn-ghost" onClick={backToLibrary}>
            <ArrowLeft size={16} /> Bibliothek
          </button>
        ) : (
          <button className="btn-ghost" onClick={handleLogout}>
            <LogOut size={16} /> Abmelden
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
          onChromeHiddenChange={setPerformChromeHidden}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Login
--------------------------------------------------------------- */
function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError("E-Mail oder Passwort falsch.");
  }

  return (
    <form className="sb-editor" onSubmit={handleLogin}>
      <label className="field">
        <span>E-Mail</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Passwort</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && <div className="import-error">{error}</div>}

      <div className="editor-actions">
        <button type="submit" className="btn-gold" disabled={loading}>
          {loading ? "Anmelden …" : "Anmelden"}
        </button>
      </div>
    </form>
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

      {songs.length === 0 && <div className="sb-empty">Noch keine Songs. Leg los mit „Neuer Song".</div>}

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
          <span>Verzögerung</span>
          <input
              type="number"
              min={0}
              step={0.5}
              value={scrollDelay}
              onChange={(e) => setScrollDelay(e.target.value)}
              placeholder="0"
          />
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
        <code>##</code> beginnen, werden als Abschnitt (z. B. Strophe, Refrain) hervorgehoben. Ein{" "}
        <code>|</code> in einer Zeile markiert eine Stelle, an der auf schmalen Bildschirmen (Handy) umgebrochen
        wird — auf größeren Bildschirmen bleibt die Zeile unverändert. Die Scroll-Verzögerung bestimmt, wie viele
        Sekunden nach dem Start gewartet wird, bevor der Text zu scrollen beginnt.
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
   Mobile-Erkennung: rein pixelbasiert über matchMedia, kein
   manueller Schalter. Bei Bedarf später um ein Override erweiterbar,
   ohne dass sich an der Grundlogik etwas ändert.
--------------------------------------------------------------- */
const MOBILE_BREAKPOINT = 720;

function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e) => setIsMobile(e.matches);
    handler(mq); // einmal synchron abgleichen, falls sich die Breite vor dem Mount geändert hat
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpoint]);

  return isMobile;
}

/* ---------------------------------------------------------------
   Steuerzeichen im Songtext: "|" markiert eine Stelle, an der im
   Mobile-Modus umgebrochen werden soll. Im Desktop-Modus wird es
   einfach entfernt, hat dort also keine sichtbare Wirkung.
--------------------------------------------------------------- */
function splitForDisplay(line, isMobile) {
  if (!isMobile) return [line.replace(/\|/g, "")];
  return line.split("|");
}

/* ---------------------------------------------------------------
   Tempo: wie bei der Transponierung nur eine Stufe (…, -1, 0, +1, …)
   einstellen und speichern; die tatsächliche Scroll-Geschwindigkeit
   (px/sec) ergibt sich daraus über eine gemeinsame Grundgeschwindigkeit.
--------------------------------------------------------------- */
const BASE_SCROLL_SPEED = 18; // px/sec bei Stufe 0 - unsere "gute Grundgeschwindigkeit"
const SPEED_STEP_PX = 2; // px/sec, um die jede Stufe die Geschwindigkeit ändert

function speedForSteps(speedSteps) {
  return Math.max(2, BASE_SCROLL_SPEED + speedSteps * SPEED_STEP_PX);
}

// Wie lange (ms) nach der letzten manuellen Scroll-Bewegung (Maus/Trackpad-
// Wheel oder Touch) gewartet wird, bevor das Auto-Scrolling weiterläuft.
const MANUAL_SCROLL_RESUME_DELAY = 1500;
// Wie lange (ms) nach Start des Abspielens, bis Header/Pedalboard ausgeblendet werden
const HIDE_CHROME_DELAY = 1000;

/* ---------------------------------------------------------------
   Performer: Scroll-Ansicht mit Transponieren & Tempo
--------------------------------------------------------------- */
function Performer({ song, onBack, onEdit, onSaveSpeed, onChromeHiddenChange }) {
  const isMobile = useIsMobile();
  const [steps, setSteps] = useState(0);
  const [speedSteps, setSpeedSteps] = useState(song.speed ?? 0); // Tempo-Stufe, wie bei Transponierung
  const speed = speedForSteps(speedSteps);
  const [playing, setPlaying] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [tempoSaved, setTempoSaved] = useState(false);
  const [countdown, setCountdown] = useState(null); // Sekunden bis Scroll-Start, oder null

  const [chromeHidden, setChromeHidden] = useState(false);
  const hideChromeTimeoutRef = useRef(null);

  function showChrome() {
    setChromeHidden(false);
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
  }

  function scheduleHideChrome(delay = HIDE_CHROME_DELAY) {
    if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    hideChromeTimeoutRef.current = window.setTimeout(() => setChromeHidden(true), delay);
  }

  // Beim Start/Stopp des Abspielens ein-/ausblenden
  useEffect(() => {
    if (!playing) {
      showChrome();
      return undefined;
    }
    scheduleHideChrome();
    return () => {
      if (hideChromeTimeoutRef.current) window.clearTimeout(hideChromeTimeoutRef.current);
    };
  }, [playing]);

  // Sichtbarkeit nach oben an Songbook melden (für .sb-header)
  useEffect(() => {
    onChromeHiddenChange?.(chromeHidden);
  }, [chromeHidden, onChromeHiddenChange]);
  
  function handleSaveTempo() {
    onSaveSpeed(speedSteps);
    setTempoSaved(true);
    window.clearTimeout(handleSaveTempo._t);
    handleSaveTempo._t = window.setTimeout(() => setTempoSaved(false), 1600);
  }

  const scrollRef = useRef(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(null);
  const speedRef = useRef(speed);
  const scrollPosRef = useRef(0); // exakte, nicht gerundete Scroll-Position
  const manualPauseUntilRef = useRef(0); // Timestamp, bis zu dem manuelles Scrollen respektiert wird

  // Aktuelles Tempo immer in einer Ref halten, damit der Scroll-Loop
  // unten sie live lesen kann, ohne dass der Effekt neu gestartet werden muss.
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Manuelles Scrollen (Maus-Wheel, Trackpad, Touch-Swipe) erkennen: setzt nur
  // einen "bis wann pausieren" Zeitstempel, der Scroll-Loop selbst greift das
  // unten in step() ab - so bleibt die exakte Position jederzeit synchron.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    function markManualScroll() {
      manualPauseUntilRef.current = Date.now() + MANUAL_SCROLL_RESUME_DELAY;
      showChrome();
      scheduleHideChrome(MANUAL_SCROLL_RESUME_DELAY + HIDE_CHROME_DELAY);
    }

    el.addEventListener("wheel", markManualScroll, { passive: true });
    el.addEventListener("touchstart", markManualScroll, { passive: true });
    el.addEventListener("touchmove", markManualScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", markManualScroll);
      el.removeEventListener("touchstart", markManualScroll);
      el.removeEventListener("touchmove", markManualScroll);
    };
  }, []);

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
          const el = scrollRef.current;
          if (Date.now() < manualPauseUntilRef.current) {
            // Nutzer scrollt gerade selbst (Wheel/Touch): nicht überschreiben,
            // nur unsere Position synchron mit der tatsächlichen Scroll-Position
            // halten, damit es beim Weiterlaufen keinen Sprung gibt.
            scrollPosRef.current = el.scrollTop;
          } else {
            const dt = (ts - lastTsRef.current) / 1000;
            // Nachkommastellen selbst mitführen statt sie über scrollTop
            // (das der Browser auf ganze Pixel rundet) verloren gehen zu lassen.
            scrollPosRef.current += speedRef.current * dt;
            el.scrollTop = scrollPosRef.current;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
              setPlaying(false);
            }
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
              const segments = splitForDisplay(line, isMobile);
              return (
                <div key={i} className="song-line-group">
                  {segments.map((seg, j) => {
                    const { lyric, chords } = parseLine(seg);
                    const chordLine = buildChordLine(chords, steps);
                    return (
                      <div key={j} className="song-line">
                        {chordLine.trim() !== "" && <div className="chord-line">{chordLine}</div>}
                        <div className="lyric-line">{lyric || "\u00A0"}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="scroll-end-space" />
          </div>
        </div>
      </div>

      <div className={"pedalboard" + (chromeHidden ? " pedalboard-hidden" : "")}>
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
          <button className="pedal-small" onClick={() => setSpeedSteps((s) => s - 1)} title="Langsamer">
            <ChevronDown size={16} />
          </button>
          <div className={"led" + (speedSteps !== 0 ? " led-on" : "")}>
            {speedSteps > 0 ? `+${speedSteps}` : speedSteps}
          </div>
          <button className="pedal-small" onClick={() => setSpeedSteps((s) => s + 1)} title="Schneller">
            <ChevronUp size={16} />
          </button>
          <button
            className={"remember-btn" + (tempoSaved ? " remember-btn-done" : "")}
            onClick={handleSaveTempo}
            title="Aktuelle Tempo-Stufe für diesen Song merken"
          >
            {tempoSaved ? "Gemerkt ✓" : "Tempo merken"}
          </button>
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
      </div>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={14} /> zur Bibliothek
      </button>
    </div>
  );
}
