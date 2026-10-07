# Reading numbered notation for whistle transcription

Use this as a transcription checklist, not as an OCR shortcut. Numbered-notation (简谱)
conventions vary by publisher. Inspect the score's legend first; if a mark can change pitch
or rhythm and stays ambiguous, mark its location and ask the user.

## Pitch and octave

- `1`–`7` are scale degrees relative to the printed `1 = ...` tonic, not fixed note names.
  Apply the printed mode and key before converting them to sounding pitches.
- A dot above or below a numeral commonly changes its octave. Preserve the direction and the
  count. A dot *after* a note commonly lengthens it — do not confuse the two placements.
- `0` commonly means a rest. Preserve accidentals and their scope. Never infer the numbered
  tonic from the physical key of the whistle.
- Watch for `1 = C` being written as instrumentation shorthand for a transposing part. Ask
  rather than assuming.

## Duration and articulation

- A dot after a note commonly adds half its value; multiple augmentation dots may occur.
- Short lines under or joining notes commonly divide the beat into shorter values. Count the
  beam levels and verify against the legend or a clearly readable measure.
- A dash can mean a held value in some numbered scores. A tie/arc between equal pitches
  sustains one sound; a slur over changing pitches connects them smoothly.
- A dot below a note can indicate octave or staccato depending on placement and publisher
  style. Use the legend and repeated patterns to disambiguate.
- Preserve bar lines, repeats, endings, fermatas and phrase marks where the editor supports
  them; describe the rest instead of silently flattening them.

## Rhythm audit

1. Transcribe one complete measure at a time, including rests and ties.
2. Convert each written value using the score's meter and notation legend.
3. Sum the measure. A mismatch may reveal a missed beam, a dot, a tie, a pickup or an OCR
   ambiguity. Do not correct it silently.
4. Digits without rhythmic marks do not specify durations. Request audio or rhythm, or label
   any chosen rhythm as an arrangement.

## Lyrics

- Align syllables by visual columns and phrase context, not by arbitrary OCR whitespace.
- Punctuation can guide phrasing but is not a sung syllable.
- If text is obscured, leave it blank and flag the location. Do not complete copyrighted
  lyrics from memory or from an unverified search result.

## Mapping to WhistleLoom

### The two independent choices

- **`tonic`** is the pitch that numbered `1` stands for. It draws the numbered layer and
  sets the key signature.
- **`whistleKey`** is the physical instrument the fingering diagrams are drawn for.
- They have nothing to do with each other. A tune in D played on a D whistle, a tune in G
  played on a D whistle, and a G tune on a G whistle are all normal; only the fingering
  chart changes.

Allowed tonics, modes and whistle keys are listed in
[editor-contract.md](editor-contract.md).

### Scale degree → sounding pitch

The editor stores **absolute MIDI pitch**, so every numeral has to be resolved. The
semitone offsets for the four supported modes (degree 1 through 7):

| Mode | Offsets |
| --- | --- |
| major | 0, 2, 4, 5, 7, 9, 11 |
| minor (Aeolian) | 0, 2, 3, 5, 7, 8, 10 |
| dorian | 0, 2, 3, 5, 7, 9, 10 |
| mixolydian | 0, 2, 4, 5, 7, 9, 10 |

Then: `midi = tonicMidi + offset[degree] + 12 × (octave shifts) + accidental`, with the
accidental applied **after** the mode's offset (a raised 4th in Dorian is offset 5 + 1 = 6).
`C` is MIDI 60, `D` 62, and the editor accepts 24–108.

Check the result against the whistle's range. A tin whistle is a diatonic instrument: a
tune that leans on the printed tonic being a specific instrument key may need transposition
rather than transcribing as written.

### Durations

The editor stores durations in **quarter-note beats** and accepts only these twelve values:

```
0.125  0.25  0.375  0.5  0.75  1  1.5  2  3  4  6  8
```

A value that cannot be represented exactly (a triplet, a doubly-dotted note) is snapped to
the nearest one by the importers, **with a warning**. If you are producing a project file by
hand, do the same and say which values moved rather than rounding silently.

### Ties and slurs

- `tieToNext` is for two notes **of the same pitch** that form one sustained sound.
- `slurToNext` is a phrase arc across changing pitches.
- A `tieToNext` whose next note is missing, is a rest, or has a different pitch makes the
  file **invalid** — the editor refuses it. Importers downgrade that case to a slur and
  report it. Prefer a single long note when it matches the source.

### What will be lost

Repeats, first and second endings, dynamics, ornaments, fermatas, multiple verses, a piano
accompaniment, and any key / meter / tempo change inside the tune have nowhere to go. See
"What the model cannot represent" in [editor-contract.md](editor-contract.md). Report these
as ceilings of the tool, not as bugs.

The renderer engraves fewer duration cases than the data model accepts — verify tuplets,
multiple dots and uncommon durations in the rendered score before calling the output
publication-ready.

## Confidence report

List uncertainty by measure and event. Keep clearly read facts, inferred pitch or rhythm,
and arrangement choices in three separate lists. Never describe a guessed transcription as
exact.
