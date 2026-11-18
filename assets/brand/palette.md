# Brand tokens

Four values, no exceptions. Everything in the interface and every asset in this
folder is built from them.

| Token  | Hex       | Role                                              |
| ------ | --------- | ------------------------------------------------- |
| paper  | `#f2ede3` | Ground. Page background, mark interior, favicon rules. |
| ink    | `#17150f` | All text, the mark body, rules, borders.          |
| accent | `#c3402a` | The diagonal stroke. One job, nothing else.       |
| muted  | `#4a4438` | Metadata lines, captions, secondary labels.       |

## Rules

- The accent is a single stroke. It is never a background, never a border,
  never a fill behind text, and never applied to more than one element at a
  time on a surface.
- Ink on paper, or paper on ink. No third combination, no reversal to accent.
- Status is never carried by colour alone. Colour may reinforce a label, a
  glyph, or a weight change; it may not be the only signal.
- No gradients, no glass, no translucency, no drop shadows, no emoji.
- Hairlines are 1px at 1x and stay 1px when the layout scales. Do not thicken
  borders to compensate for low-contrast monitors.

## Artwork

The mark is an ink square with three rule lines cut out of it, struck through by
one accent diagonal. The mono variant drops the accent and cuts the diagonal out
of the ink instead, so the square reads as a single colour at any size.

`mark.svg` and `mark-mono.svg` are 64 grid units square. `favicon.svg` is
tuned for 16px: 8-unit rules, no stroke thinner than 2 units, no text.

## Replacing the accent

Both `mark.svg` and `wordmark.svg` read `--brand-accent` with a `#c3402a`
fallback, and `mark.svg` reads `--brand-paper` with a `#f2ede3` fallback, so a
host page can retheme the stroke without editing the file:

```css
:root {
  --brand-accent: #c3402a;
  --brand-paper: #f2ede3;
}
```

`mark-mono.svg` has no accent and inherits `currentColor` only.
