# The WhistleLoom score contract

Everything the editor can hold, and everything it cannot. Written so that a produced
`.json` project file or imported notation is accepted on the first try.

The source of truth is `js/score-model.js` (`normalizeScoreData`); `scripts/check-facts.mjs`
asserts the numbers below still match it. If the two ever disagree, the code wins and the
checker fails.

## One data source, many views

`score.events` is the only representation of the music. The staff, the numbered notation,
the lyrics, the whistle-fingering diagrams, playback, and every export are all **derived**
from it. Two consequences that shape everything else:

- **Pitches are absolute (concert pitch), not scale degrees.** `tonic` and `mode` describe
  the key signature to draw and the `1=` to print; they do not transpose the notes.
  Transposing rewrites every `pitch` in `events`.
- **Nothing is stored twice.** There is no separate "numbered notation form" and no
  "whistle fingering form" to keep in sync.

## Top-level fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | integer | `1`. Files without it are read as version 1. A future version number is rejected with a friendly message rather than half-read. |
| `title` | string | trimmed, ≤ 200 chars, defaults to `未命名曲谱`. Also decides the export filename (`scoreBaseName` strips `\ / : * ? " < > \|`, trailing dots and spaces, and caps at 100 chars). |
| `subtitle` | string | ≤ 200 chars |
| `composer` | string | ≤ 200 chars. ABC: `C:` |
| `lyricist` | string | ≤ 200 chars. ABC: `% Lyricist:` |
| `arranger` | string | ≤ 200 chars. ABC: `% Arranger:` |
| `sourceTonic` | string | one of the tonics below, or `""`. The key *before* a transposition; shown as `原调 X → `. ABC: `% SourceTonic:` |
| `tonic` | string | the `1=` of the numbered layer. Default `C`. |
| `mode` | string | one of `major`, `minor`, `dorian`, `mixolydian`. Default `major`. |
| `meter` | string | `numerator/denominator`, numerator **1–32**, denominator a power of two **≤ 32**. Default `4/4`. |
| `whistleKey` | string | which instrument the fingerings are drawn for. Default `D`. |
| `tempo` | number | 20–400 BPM, quarter-note beats per minute. Default 96. |
| `originalTempo` | number | 20–400. The tempo the score was imported with; the 「原曲」 button restores it. Defaults to `tempo`. |
| `events` | array | ≤ 10 000 entries |

### Allowed tonics (17)

```
C  C#  Db  D  D#  Eb  E  F  F#  Gb  G  G#  Ab  A  A#  Bb  B
```

Both spellings of each black key are accepted, so enharmonic names survive a round trip.
`G#` and `Ab` are *not* merged — an imported score that says A♭ major stays A♭ major.

### Allowed whistle keys (7)

```
C   D   Eb   F   G   A   Bb
```

These are the seven keys a six-hole tin whistle is actually sold in. The key is what the
fingering layer is drawn against, and it also picks the base pitch used for range checks —
the numbers live in `whistleMidi` in `app.js`, so read them there rather than copying a
table into your head or into a document.

### Modes

Only four modes are editable. This is deliberate: Irish and Scottish session repertoire is
essentially all major / minor (Aeolian) / Dorian / Mixolydian, and the key-signature maths
for the rest is where bugs come from.

The mode word in `K:` is matched **case-insensitively, on letters only, against these
prefixes**:

| Written | Read as |
| --- | --- |
| `maj`, `ion` | major |
| `min`, `aeo` | minor |
| `m` (on its own) | minor |
| `dor` | dorian |
| `mix` | mixolydian |
| `phr` | phrygian |
| `lyd` | lydian |
| `loc` | locrian |

Then the four editable modes are kept, and the rest fall back — **with a warning**:

| Input | Result |
| --- | --- |
| `K:Ador`, `K:Ddor`, `K:Gm`, `K:Gmin`, `K:Dmix`, `K:Dmaj`, `K:Dion`, `K:Daeo` | kept |
| `K:C` with no mode word at all | `major` |
| `K:Aphr` | → `minor`, warning `弗里吉亚调式暂不支持，已按自然小调导入，请核对调号` |
| `K:Alyd` | → `major`, warning |
| `K:Aloc` | → `minor`, warning |
| `K:Dd` (an abbreviation that matches no prefix) | → **`major`, silently, with no warning at all** |

That last row is the trap: a mode word that matches nothing is not reported, it just
becomes major. **Always write the mode word in full** (`dor`, `mix`, `min`) rather than
inventing a short form. Per the ABC standard, `K:D` alone means D major and `K:Dm` means D
minor; every other mode needs its full three-letter word.

## Events

```json
{ "pitch": 74, "duration": 1, "lyric": "风", "barAfter": false,
  "tieToNext": false, "slurToNext": true }
```

| Field | Rule |
| --- | --- |
| `pitch` | **MIDI note number, 24–108**, or `null` for a rest. `60` = middle C (C4). 24 = C1, 108 = C8. Not a scale degree, not a whistle hole number. |
| `duration` | must be one of the 12 values below, measured in **quarter-note beats** |
| `lyric` | string ≤ 200 chars, `""` when the note carries no syllable |
| `barAfter` | `true` = draw a bar line after this event. Manual barlines live here; they are not derived from the meter. |
| `tieToNext` | `true` = this note is **tied** into the next one |
| `slurToNext` | `true` = a phrase arc to the next note |

### The duration grid (12 values)

```
0.125  0.25  0.375  0.5  0.75  1  1.5  2  3  4  6  8
```

In quarter-note beats, that is: 32nd, 16th, dotted 16th, 8th, dotted 8th, quarter, dotted
quarter, half, dotted half, whole, dotted whole, two wholes. **Anything else is rejected**
— a triplet quarter (2/3) and a doubly-dotted note (1.75) cannot be stored. Importers snap
to the nearest grid value and say so; when you produce a file by hand, snap it yourself and
state the change.

Note the gap: the data model accepts 12 values, but the **renderer engraves fewer**. Tuplets,
multiple dots and unusual durations must be checked in the rendered score before anyone
calls the output publication-ready.

### The tie rule is a hard error

`tieToNext: true` requires the next event to exist, have a non-null `pitch`, and have **the
same pitch**. Otherwise the whole file is rejected with
`第 N 个音符的延音线必须连接到下一颗同音高音符。`

This catches a real class of import bugs: a source that ties a note across a bar line where
the parser dropped the second note. Importers never write such a file — `sanitizeTies`
drops a tie that has nothing to connect to, and turns a tie between *different* pitches
into a slur (which draws the same arc without changing what the durations mean). Both cases
are reported to the user rather than fixed quietly.

## What the model cannot represent

Say this plainly to the user when the source contains any of it. These are ceilings of the
model, not bugs in the importer:

- **One melody voice.** No chords, no harmony, no counter-melody, no bass line.
- **No accompaniment**: no chord symbols, no piano part, no guitar tab, no drum part.
- **No structure**: no repeat signs as structure (a repeat becomes two bar lines), no
  first/second endings, no D.C./D.S., no coda.
- **No changes during the tune**: no key change, no time-signature change, no tempo change
  mid-score. Exactly one key, one meter, one tempo per score.
- **No performance marks**: no dynamics, no staccato/tenuto, no accents, no fermatas, no
  ornaments (trills, grace notes, mordents), no pedal.
- **No percussion** and no unpitched sounds other than a rest.

If a user needs any of these, the honest answer is that WhistleLoom is a single-melody whistle
editor and another tool should own that part of the job — not that the feature is coming.

## Validation quick reference

Rejections the editor can produce, and what usually caused them:

| Message | Cause |
| --- | --- |
| `曲谱文件格式无效：需要一个曲谱对象。` | top level is an array or a non-object |
| `此曲谱文件版本暂不支持…` | `schemaVersion` above 1 |
| `曲谱音符数据无效或超过 10,000 个音符。` | `events` missing, not an array, or too long |
| `曲谱主音“X”暂不支持。` | typo or an unsupported spelling |
| `曲谱调式“X”暂不支持。` | a mode outside the four; importers fall back instead |
| `曲谱拍号“X”暂不支持。` | numerator > 32, or a denominator that is not a power of two |
| `曲谱哨笛调“X”暂不支持。` | a whistle key outside the seven |
| `曲谱速度须在 20–400 BPM 之间。` | out of range. (This range used to be 20–320 while the UI allowed 400, which meant typing 400 quietly produced an autosave that failed to load. The range now lives in one place.) |
| `第 N 个音符音高超出可处理范围。` | not an integer, or outside 24–108 |
| `第 N 个音符时值暂不支持。` | not on the 12-value grid |
| `第 N 个音符的延音线必须连接到下一颗同音高音符。` | dangling or mismatched tie |
