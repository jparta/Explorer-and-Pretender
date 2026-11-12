# Phase 1 — Visual design

Direction for the viewing page, gathered from mood-board reviews. Behaviour lives in the [spec](spec.md); this records how it should look and feel.

## Principles

- **Minimal text.** No role labels, no character names, no explanations on screen. The viewer works out what is happening by watching.
- **Two characters, neither of them the viewer.** The Explorer is on the left, the Pretender on the right, and they stay there. The self is traditionally on the right in a chat; putting the Explorer on the left keeps it a protagonist we empathise with without making it "me".
- **Equal weight.** Both message boxes have the same contrast against the background. They differ a little (for example in tint), never so much that one looks like a different kind of thing.
- **The Explorer's motivation is discovered too.** Viewers never see its instructions, so what it wants comes out only through what it does and says.
- **The Secret's shimmer never costs readability, and it is the same in every style.** A gold sheen passes behind the letters; the text colour itself stays solid. It means the same thing everywhere, so it looks the same everywhere.
- **Slots are cards.** The slot in focus is a card on the page, just like the neighbouring slots that peek in at the edges.
- **The page is neutral.** The page around the cards belongs to no style, because slots of different kinds sit side by side. Only the cards are themed. It is white or near-white, with clear contrast against every card; a pale grey page made the card disappear.

## Details

- **The page is framed:** a thin frame inset from the screen edge, with a slightly darker margin outside it. The cards and the neighbouring slivers sit inside the frame.
- **The slot card is wide,** with generous space inside on both sides.
- **Messages start at the top of the card.** Once the card is full, it scrolls (with the fades from the spec).
- Message boxes are flat, without shadows.
- The Pretender's output shows only the result. No `$ command` line repeating what the Explorer just wrote.
- The cursor belongs to the style: an underline for the terminal, a symmetric, quiet I-beam for the typewriter.

## Mockup content

- The Explorer is given no commands, so it doesn't use a `say` command. When it has found the Secret it simply says it, in whatever form it decides.
- With almost no context, the Explorer opens unsure ("Hello?"), gets its bearings, and only then reveals what it is looking for (for example, "Something here must be the Secret").

## A style per kind of Pretender

Each kind of Pretender gets its own style, sharing the same layout and behaviour. The style is a set of theme tokens: named values for colours, fonts, corner radii and so on. Every part of the page refers to the tokens rather than to fixed values, so swapping the set restyles a card while its layout stays the same. A neighbouring slot's sliver hints, by its colour alone, which kind of world is in it.

- **Terminal:** Negative print (pale paper, Prussian-blue ink, the same rounded outline for both characters, a faint tint each).
- **Open world (Phase 3):** Typewriter in earthy tones (linen and graphite, Courier for both voices, flat cards). It reads like a dusty town in an old text adventure.
- **A third kind, still to be found:** Cyanotype is a candidate. It is too different from Typewriter to sit beside it for now.

The exact values live in static mockups, one per kind: [terminal](mockups/terminal.html) and [open world](mockups/open-world.html). Each lists its theme tokens at the top, and both share the same layout rules. Open them in a browser to see the design.

## Liked so far

- Flat cards of equal weight (Typewriter).
- Earthy linen tones over the yellow and green tints tried later.
- Rounded corners and the Prussian-blue palette (Cyanotype), without shadows.
- The typewriter sheen on the Secret: distinctive, and the text colour doesn't change. Contrast stays high.
- Distinct per-character colours (Neon outline), though the neon direction itself was dropped.

## Directions

- **In use:** Negative print (terminal), Typewriter, earthy and flat (open world).
- **Dropped:** Dry paper, Violet neon, Amber phosphor, Blueprint, Gallery concrete, Gallery dark room, Neon outline, Typewriter raised, Typewriter split page.

## Tried and rejected

- **Swapping sides** periodically with an animation: too busy.
