# SuperSonicCleaner design system

SuperSonicCleaner reads like a technical report: solid graphite surfaces, one flat card per section, rows separated by hairlines, numbers in tabular figures and colour reserved for a few roles. The system is adapted to a full desktop workspace and includes an equally deliberate light theme.

## Source of truth

`src/renderer/src/design-tokens.css` owns colours, fonts, shapes, spacing and motion values, for the dark theme (`:root`) and the light theme (`.light`). No other file defines colours, shadows, radii or durations. `globals.css` holds the document base, the application shell and the defaults for native controls (in Tailwind's base layer, so component classes win); the primitives in `src/renderer/src/components/ui/` (Button, Card and Section, Table, Tag, Switch, Segmented, Checkbox, ProgressBar) and the shared `EmptyState`, `ConfirmDialog`, `Receipt` and `PageHeader` draw everything else from the tokens.

| Role                     | Token                                                      | Dark                  | Light                 |
| ------------------------ | ---------------------------------------------------------- | --------------------- | --------------------- |
| Canvas, card, control    | `--page-bg`, `--card-bg`, `--surface`                      | `#121216` … `#26262E` | `#F5F5F7` … `#ECECF0` |
| Text                     | `--text-primary`, `--text-secondary`, `--text-muted`       | `#F5F5F7` … `#A1A1AA` | `#18181D` … `#62626D` |
| Primary button           | `--primary-bg`, `--primary-fg`                             | White, graphite text  | Graphite, white text  |
| Recommended (only)       | `--signal-rec`, `--signal-rec-text`, `--signal-rec-bg`     | `#FBBF24`             | `#D97706`             |
| Verified result (only)   | `--signal-ok-text`                                         | `#86EFAC`             | `#166534`             |
| Errors, threats, danger  | `--signal-danger`, `--signal-danger-text`, `--danger-button-bg` | `#F87171`        | `#B91C1C`             |
| Chart series, meters     | `--chart-1`, `--chart-2`, `--track`                        | `#C7C7D0`, `#9BBAFA`  | `#494953`, `#315EAF`  |

Amber marks only what the app recommends (recommended rows and steps, pre-selected items, "Consigliato"), never a button. Green marks only a verified result. Red marks only errors, threats and the confirmation of an irreversible action. Generic warnings use the `AlertTriangle` or `Info` icon with neutral text. Navigation and primary actions remain neutral. Focus uses a separate blue token (`--focus`) in both themes. `src/renderer/src/design-tokens.test.ts` checks the contrast of every text and control pair.

## Type and shape

The product wordmark uses outlined, heavy lowercase oblique lettering on a black rectangle with a thin white border, inspired by the classic Oasis identity. The app and tray icons use the matching lowercase initial. SVG sources live in `resources/branding`; `scripts/generate-brand-icons.cjs` generates platform assets. `BrandWordmark` provides standard, large and compact variants without distributing a font file.

Titles use Segoe UI Variable Display; body and controls use Segoe UI Variable Text. Both fall back to Segoe UI and the platform system font. Numbers use the UI font with tabular figures. The scale is `--text-11`, `--text-12`, `--text-13` (text), `--text-15` (section titles), `--text-20`, `--text-26` (page titles) and `--text-hero` (one main number per screen), with weights 400, 500 and 600, letter spacing 0 and no decorative uppercase except the wordmark.

Radii are `--radius-control` (6px: buttons, fields, checkboxes), `--radius-container` (10px: cards, dialogs, menus) and `--radius-pill` (switches and status chips). Spacing follows a 4px grid, `--space-1` to `--space-7`. Cards are flat: a 1px `--border-default` border and no shadow; `--shadow-flyout` is only for menus and dialogs. No gradients, glows, blur or illustrations.

## Interaction

A view has at most one primary button. Secondary actions use solid control surfaces; ghost buttons carry low-emphasis actions. Focus remains visible with a 2px `--focus` outline. Every theme provides its own values; do not copy dark-theme hex values into components.

`controls.css` styles shared single-select controls and their option menus in both themes. It progressively enables `appearance: base-select`, retaining native keyboard behavior and a standard select fallback on older engines.

Operation state and IPC progress belong to stores or operation runners, independently of mounted tool pages. View navigation must preserve active scans, recordings, drafts and AI results; changing the underlying scan invalidates its AI recommendations. The notch animates its renderer surface for 240ms, then shrinks the native window after completion instead of resizing it every animation frame.

Transitions use `--duration-feedback` (120ms) for hover and press and `--duration-enter` (200ms) for entrances and expansions, with `--ease-out`, and animate only opacity, transform and colours; progress bars use `transform: scaleX()`. Only spinners and indeterminate progress bars loop. The global reduced-motion policy disables animation and transition duration. Responsive layouts preserve readable content and reachable actions at narrow window sizes.

## Writing

The app reads like a report: every screen says what was measured, when, what would change and within which limits. Italian and English are the source copy; every other language follows the same rules.

- A title names the screen. A subtitle is there only when it says what the screen reads or changes, or where it stops.
- Say what was checked, when and with which limits. Never promise an outcome such as "the system is clean" or "everything is protected". A result is green only when a check verified it; a partial or failed check says so.
- No slogans, no exclamation marks, no words in capitals (acronyms such as DISM or CPU are fine) and no "Label — sentence" openings.
- Keep states and verbs apart: a state describes ("Off", "On for 5 min"), a button acts ("Turn on", "Turn off").
- In Italian the product does *pulizia*, *controllo* and *manutenzione*; it never offers *cura*.
- Numbers carry their unit and follow the format of the language (`formatBytes`, `formatCount`, `formatPercent`).

| Avoid                                  | Write                                                       |
| -------------------------------------- | ----------------------------------------------------------- |
| "Your PC is clean!"                    | "Nothing to clean in the scanned categories"                |
| "Up to date" after a check that failed | "Check incomplete: winget"                                  |
| "CLEAN NOW"                            | "Clean 2.34 GB"                                             |
| "Scan complete" after a cancel         | "Scan stopped: results are partial."                        |
| "Heads up — admin rights needed"       | "2 categories not scanned: they need administrator rights." |
| "Game mode: ACTIVE"                    | "On for 12 min", with a "Turn off" button                   |

## Design check

`npm run check:design` runs `scripts/check-design.mjs`. It is part of `npm run check` and runs in CI, so a violation fails the build. It reports each violation with its file and line.

In the renderer code (`src/renderer/src`: TypeScript, TSX and CSS, tests excluded):

- colour literals (`#hex`, `rgb()`, `rgba()`, `hsl()`) outside `design-tokens.css`: use a token;
- gradients outside `design-tokens.css`, and `backdrop-filter` or `backdrop-blur`;
- `transition-all` and `transition: all`: name the properties that change;
- pixel font sizes in class names such as `text-[13px]`: use `text-[length:var(--text-13)]`;
- `uppercase` and `text-transform: uppercase`, except in the wordmark;
- the `Sparkles` icon outside `components/ai/` and the AI analysis pages, and the `Rocket`, `Flame` and `Wand2` icons.

In the Italian and English copy (`src/renderer/src/locales/it` and `en`):

- text in capitals, except the acronyms listed in the script;
- an exclamation mark;
- an opening in the form "Label — sentence";
- the words *cura* and *cure* in Italian.

A line that contains `design-allow` is exempt; say on the same line why the rule does not apply there. `node scripts/check-design.mjs --list` lists every violation, and `node scripts/check-design.mjs --strict <files or folders>` checks only the paths given.
