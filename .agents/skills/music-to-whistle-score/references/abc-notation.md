# ABC quick guide for whistle melodies

ABC 2.1 is the editor's preferred text interchange and its own export format: plain text,
human-editable, and readable by every session musician's tooling. Everything below was
checked against the editor's real parser (`js/abc.js`); `scripts/check-facts.mjs` re-checks
the parts that can be asserted mechanically.

## Fields the parser reads

```abc
X:1
T:Tune title
C:Composer
% Lyricist:Lyricist
% Arranger:Arranger
% SourceTonic:C
% Subtitle:Subtitle
M:4/4
L:1/8
Q:1/4=100
K:Ador
|: E2 A2 ABcd | e2d2 c2A2 :|
w: Hel-lo world, sing a- long
```

- `X:` tune index, `T:` title, `C:` composer, `M:` meter, `L:` default note length,
  `Q:` tempo, `K:` key, `w:` lyrics.
- Four pieces of metadata have **no standard ABC field**, so the editor reads them out of
  comments with these exact names: `% Lyricist:`, `% Arranger:`, `% SourceTonic:`,
  `% Subtitle:`. Any other `%` line is an ordinary comment and is discarded.
- **`% Source:` is not read.** It is a comment like any other. Put the source in your reply
  to the user instead of relying on it surviving a round trip.
- `L:` is the unit note length: with `L:1/8` an unmarked note is an eighth and `E2` is a
  quarter. If `L:` is absent the parser derives it from the meter **and says so**, because
  the derived value may not be what the transcriber had in mind.
- `Q:1/4=100` is 100 quarter notes per minute. The older bare form `Q:100` means "100 unit
  notes per minute" and is converted using `L:`.
- `K:Ador` is A Dorian, not A major. The key field sets the default key signature. See
  [editor-contract.md](editor-contract.md) for which mode words are recognised — an
  abbreviation that matches no prefix becomes major **silently**.

At least one of `X: T: M: L: Q: K: w:` must be present or the import is refused outright.
That check exists because the parser is very tolerant: it once turned a whole MusicXML file
into 255 garbage notes that *looked* like a score. A refusal is better than silent damage.

Any other `[A-Z]:` line is treated as a field and skipped, so unknown headers are harmless.

## Note spelling, duration and articulation

- Lowercase `c d e f g a b` are an octave above uppercase `C D E F G A B`; `C` is middle C
  (MIDI 60). Commas lower an octave (`C,`), apostrophes raise it (`c'`), and they stack.
- `^F` = F sharp, `_B` = B flat, `=F` = F natural, `^^`/`__` = double sharp/flat. An
  accidental lasts to the end of the measure; `|` resets the accidental state.
- A number multiplies the unit length (`A2`); `/` halves it (`A/`); `3/2` multiplies by
  one and a half (`A3/2`). **A dot is not the dotted-note syntax** — write the multiplier.
- `z` is a rest (upper- or lowercase).
- `-` ties a note to the next one; `(...)` is a slur.
- `|` is a bar line; `|:`, `:|`, `|]` are repeats and a final bar.

## Lyrics

Put a `w:` line right after the melody line it belongs to:

```abc
K:G
G2 A B c2 | d2 B2 A4 |
w: Hel-lo world, sing a- long
```

The importer reads **only the first `w:` line**, splits it on whitespace, and maps tokens to
*pitched* notes in order (rests are skipped). `*` and `_` mean "no syllable"; a trailing `-`
is stripped as a syllable divider. ABC also defines several alignment markers — the editor
does not implement them.

For reliable import, emit **one token or `*` per pitched note**, then check the alignment in
the editor. Never invent or fill in missing lyrics.

## What the editor does with each construct

Verified against the parser, not the ABC specification.

| Construct | Behaviour |
| --- | --- |
| `X: T: C: M: L: Q: K: w:` | read |
| `% Lyricist: % Arranger: % SourceTonic: % Subtitle:` | read |
| other `%` comments, other `[A-Z]:` headers | ignored silently |
| `"Am"` chord symbols and quoted text | **dropped**, warning `和弦/文字标记不会导入` |
| `!trill!` decorations | **dropped**, warning |
| `{g}` grace notes / acciaccaturas | **dropped**, warning |
| `[CEG]` chords | **dropped** (only `[1`/`[2` endings are treated specially) |
| `(3abc` tuplets, `(3:2:3` | approximated by ratio, warning that the duration grid has no 1/3 beat |
| `>` `<` broken rhythm | **dropped**, warning |
| `|:` `:|` repeats | become bar lines; **playback does not loop the repeat**, warning |
| `[1` `[2` first/second endings | markers not kept separately, warning |
| `A- A` tie | kept |
| `A- B` tie between different pitches | downgraded to a slur, warning that it happened and why |
| `A-` with nothing (or a rest) after it | dropped, warning |
| a duration off the 12-value grid | snapped to the nearest value, warning which ones changed |
| `V:` multi-voice | **the import is refused.** Emit a single melody. |
| notes outside MIDI 24–108 | **the import is refused** |

That last row is an asymmetry worth knowing. MusicXML and MIDI imports **shift the whole
melody by octaves** to fit the range; the ABC path does not, so a stray octave mark that
pushes a note outside C1–C8 fails the whole import rather than being corrected. Check the
octave marks before handing ABC to a user.

## Common transcription checks

The importer handles one melody voice, the headers above, rational pitch and rest
durations, bar lines, basic repeats, ties, simple slurs and one lyric line. It is not a
complete ABC 2.1 renderer. Keep the original source and report unsupported or lossy
constructs instead of assuming they travelled.

Before returning ABC, compare source and transcription measure by measure:

1. Check the clef and octave; an octave error changes the whistling octave and can push the
   pitch out of range.
2. Apply the key signature, then measure accidentals; reset accidental scope at bar lines.
3. Sum note and rest durations against the meter, allowing for pickups and ties.
4. Check lyric syllables against the notes actually sung, not against printed spacing.
5. Verify repeats, first and second endings, and phrase boundaries.

Then run the checker rather than trusting your own reading:

```bash
node .agents/skills/music-to-whistle-score/scripts/check-abc.mjs tune.abc
```

It reports the parsed summary, every warning the editor would raise, a per-measure duration
audit against the meter, and the pitch range reached. If a measure does not add up, or a
source symbol is ambiguous, mark the measure for review instead of adjusting notes invisibly.

## Reading an existing ABC file

For a header such as `R:march`, `M:4/4`, `L:1/8`, `K:Ador`, every unmarked melody letter is
an eighth note, so `E2A2` is a quarter E followed by a quarter A. Chord labels such as
`"Am"` are accompaniment annotations, not whistle notes — the editor drops them. This ABC
data can be transcribed by an AI without the user needing to learn the syntax.
