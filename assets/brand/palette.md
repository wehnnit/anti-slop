# Brand tokens

Four values, no exceptions. Every asset in this folder and every surface in the
interface is built from them.

| Token  | Hex       | Role                                                    |
| ------ | --------- | ------------------------------------------------------- |
| paper  | `#f2ede3` | Ground. Page background, rule cutouts, favicon rules.    |
| ink    | `#17150f` | All text, the mark body, rules, borders.                |
| accent | `#c3402a` | The diagonal stroke. One job, nothing else.             |
| muted  | `#4a4438` | Metadata lines, captions, secondary labels.             |

## Rules

- The accent is a single stroke. It is never a background, never a border, never
  a fill behind text, and never applied to more than one element at a time on a
  surface.
- Ink on paper, or paper on ink. No third combination, and no reversal to accent.
- Status is never carried by colour alone. Colour may reinforce a label, a glyph,
  or a weight change; it may not be the only signal.
- No gradients, no glass, no translucency, no drop shadows, no emoji.
- Hairlines are 1px at 1x and stay 1px when the layout scales. Do not thicken
  borders to compensate for a low-contrast display.

## Artwork

The mark is an ink square with three rule lines cut out of it, struck through by
one accent diagonal. The mono variant drops the accent and cuts the diagonal out
of the square instead, so it reads as a single colour at any size.

- `mark.svg` -- 64 grid units square. The square is `currentColor`, the rule
  cutouts and the diagonal are transparent apart from the accent, so the mark
  takes the ground it is placed on.
- `mark-mono.svg` -- 64 units square, `currentColor` only, no accent.
- `favicon.svg` -- tuned for 16px: 8-unit rules, no stroke under 2 units, no text.
- `wordmark.svg` -- mark plus ANTI-SLOP drawn as paths, 347.2 x 64, paper ground
  baked in so it stays legible on light and dark surfaces.
- `social.svg` -- 1200 x 630 card, paper ground, mark left, lockup right.

## Theming

`mark.svg` and `wordmark.svg` read `--brand-accent` with a `#c3402a` fallback, so
a host page can retheme the stroke without editing the file:

```css
:root {
  --brand-accent: #c3402a;
}
```

The square itself is `currentColor`. Set `color` to `#17150f` on paper, or to
`#f2ede3` on ink. `mark-mono.svg` works the same way and has no accent at all.
