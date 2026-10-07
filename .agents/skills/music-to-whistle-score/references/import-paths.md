# Getting music into WhistleLoom

The editor imports and exports seven things, driven by one registry (`js/formats.js`). Read
this before telling a user "that format isn't supported" — the answer is usually one of
these routes.

## What goes in and what comes out

| Format | Extensions | In | Out | Loss profile |
| --- | --- | --- | --- | --- |
| **ABC** | `.abc` `.txt` | ✔ | ✔ | Subset of ABC 2.1. See [abc-notation.md](abc-notation.md) for the exact list. |
| **MusicXML** | `.musicxml` `.xml` `.mxl` | ✔ | ✔ | Chords are reduced to their highest note, grace notes are dropped, and only the busiest voice is kept — each with a warning. |
| **MIDI** | `.mid` `.midi` | ✔ | ✔ | Import keeps pitch, rhythm and lyric meta, **reduces polyphony to the top line**, and rebuilds rests from the gaps. **Export drops lyrics.** |
| **WhistleLoom project** | `.json` | ✔ | ✔ | None — this is the editor's own file. Reversible. |
| **Reversible PDF** | `.pdf` | ✔ | ✔ | None. The score data is embedded in the file, so importing it back gives the original. |
| **Reversible PNG** | `.png` | ✔ | ✔ | None, same trick. |
| **Print** | — | ✘ | ✔ | Browser pagination; paper only. |

The seven formats are also the source for the file-picker's `accept` list, the drag-and-drop
routing and the labels on the export panel — adding a format is a one-entry change in
`js/formats.js`, and the skill's `scripts/check-facts.mjs` fails if this table drifts from it.

## How a dropped file is routed

**Content first, extension second.** This order is deliberate and was paid for with a real
bug: routing by extension alone sent a MusicXML file to the ABC parser, and the ABC parser
does not refuse — it chewed the XML tags into 255 garbage notes. The file *looked* like a
score. So:

1. **Magic bytes.** `%PDF` → PDF, `\x89PNG` → PNG, `PK\x03\x04` → a zip (used by `.mxl`;
   the MusicXML reader decides whether to unpack), `MThd` → MIDI.
2. **Text sniffing** on the decoded bytes: a `<score-partwise>`/`<score-timewise>` root →
   MusicXML, a line starting `X:`/`T:`/`K:` → ABC, parseable JSON containing an `events`
   array → a WhistleLoom project.
3. **Extension**, only as a fallback.

Two extensions are deliberately *not* treated as format declarations: **`.txt` and `.xml`**.
They stay selectable in the file picker, but a file called `随手记.txt` should be reported
as "not a score", not as "this doesn't look like ABC".

If nothing matches, the editor says so and lists the supported extensions rather than
guessing. `scripts/check-abc.mjs --routing <file>` shows what route a file would take.

## External routes: when the source is only pixels

**The editor has no optical recognition, and should not grow one.** Every OMR and
transcription tool in existence ends its pipeline at MusicXML or MIDI — exactly the two
formats the editor reads. So the job splits cleanly:

> external tool: pixels → MusicXML/MIDI &nbsp;·&nbsp; WhistleLoom: MusicXML/MIDI → an editable,
> four-layer, transposable score

Recommend the upstream half; do not re-do it by hand for a long or clearly printed score.

### Optical music recognition (staff notation)

| Tool | Notes |
| --- | --- |
| **Audiveris** (open source) | The engine behind MuseScore's PDF import. Free, runs locally, rough interface. |
| **MuseScore 4** PDF import | Audiveris, run on musescore.com's servers; needs a Pro account. |
| **Soundslice** | Commercial, has a confidence threshold: uncertain elements are shown for confirmation instead of guessed. |
| **ScanScore**, **SmartScore 64**, **PhotoScore** | Commercial; the paid tier buys a *correction* workflow, not higher accuracy. |
| **PlayScore 2** | Phone camera. Its official FAQ is a full page on how to photograph a page — which is itself the honest statement that input quality decides the result. |
| **JPeditor** (open source) | Numbered notation (简谱) screenshots → MusicXML, honouring the source coordinates. |

Set expectations honestly before recommending any of these:

- **Manufacturer-exported PDFs are a special case**: the note structure is still in the
  file as vector data, so tools like PDFtoMusic *parse* rather than *recognise*. Much higher
  accuracy than a scan.
- **Scanned print at 300 dpi+**: roughly 80–95 % per symbol.
- **Handheld photo**: roughly 60–80 %; the page must be de-skewed first.
- **Handwritten or faded scores**: no reliable option exists.

And explain why 95 % is not usable: a dense page carries 200+ symbols, so 5 % means ten
errors per page. Music has no redundancy — one wrong accidental can flip the meaning of a
whole passage. Errors are diffuse and invisible, so verification means reading the whole
score again. **For a short or messy source, typing it in is genuinely faster than fixing an
imported result** — that is a known industry finding, not a shortcut.

### Audio instead of pixels

When the user has a recording rather than a page, this branch is usually better, because
audio is a digital signal and does not depend on pixel recognition:

- **Basic Pitch**, **AnthemScore** — audio to MIDI.
- **爱扒谱 / 反谱** — MP3 to PDF + MIDI (and `.gp5` for guitar/bass).
- **MelodAI** — separated stems to MusicXML.

The result still needs correcting, but the failure mode is a wrong note in a clean stream
rather than a misread glyph, and it is the only route that works for a tune nobody has
notated.

### The one thing worth doing by hand

Falling back to Step 1 of the skill: if the tune is traditional session repertoire, the
built-in library probably already has it as ABC. That beats every route above on both cost
and correctness.

## Import warnings

Every importer writes what it changed into one list, shown in a bar **outside** the score
(so it never appears in an export or on paper). The bar only appears when something was
actually lost, and disappears again when nothing was — otherwise a stale warning from a
previous import looks like a fresh one.

When you transcribe for a user, mirror this: list what you changed, and where.
