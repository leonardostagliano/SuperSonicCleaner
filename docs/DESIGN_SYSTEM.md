# SuperSonicCleaner design system

SuperSonicCleaner uses the visual language of AIUsageMonitor: solid graphite surfaces, clear typographic hierarchy, rounded cards and restrained semantic color. The system is adapted to a full desktop workspace and includes an equally deliberate light theme.

## Source of truth

`src/renderer/src/design-tokens.css` owns colors, fonts, shapes and motion values. It loads after the legacy global stylesheet and before `pulse.css`, which defines shared components and tool workspaces. Component styles consume the tokens without creating their own theme palettes. Existing `glass-*` token names are compatibility aliases for solid surfaces; they do not imply blur or translucency.

| Role           | Dark                     | Light                    |
| -------------- | ------------------------ | ------------------------ |
| Canvas         | `#121216`                | `#F5F5F7`                |
| Card           | `#1B1B21`                | `#FFFFFF`                |
| Control        | `#26262E`                | `#ECECF0`                |
| Primary text   | `#F5F5F7`                | `#18181D`                |
| Secondary text | `#A1A1AA`                | `#62626D`                |
| Primary action | White with graphite text | Graphite with white text |
| Success        | `#4ADE80`                | `#15803D`                |
| Warning        | `#FBBF24`                | `#945900`                |
| Danger         | `#F87171`                | `#B91C1C`                |

Use `--success-text`, `--warning-text`, `--danger-text` and the corresponding `-bg` tokens for readable status labels and badges. Color communicates a system condition, not a decorative category. Navigation and primary actions remain neutral. Focus uses a separate blue token in both themes.

## Type and shape

The product wordmark uses outlined, heavy lowercase oblique lettering on a black rectangle with a thin white border, inspired by the classic Oasis identity. The app and tray icons use the matching lowercase initial. SVG sources live in `resources/branding`; `scripts/generate-brand-icons.cjs` generates platform assets. `BrandWordmark` provides standard, large and compact variants without distributing a font file.

Titles and numbers use Segoe UI Variable Display; body and controls use Segoe UI Variable Text. Both fall back to Segoe UI and the platform system font. Numeric columns use tabular figures. The scale is 38px for prominent data, 30px for page titles, 20px for section headings, 13px for body copy and 11px for captions.

Use `--radius-card` (18px), `--radius-tile` (14px), `--radius-control` (10px) and `--radius-pill` (999px). Compose spacing around a 4px base. Cards use hairline borders, subtle inset highlights and minimal shadows; a small local green glow may mark system health or the primary care card. Avoid page-wide gradients, glass blur and decorative animation.

## Interaction

Primary actions use `--accent` and `--text-on-accent`. Secondary actions use solid control surfaces. Focus remains visible with a 2px `--focus` outline. Every theme provides its own semantic colors; do not copy dark-theme hex values into components.

`controls.css` styles shared single-select controls and their option menus in both themes. It progressively enables `appearance: base-select`, retaining native keyboard behavior and a standard select fallback on older engines.

Operation state and IPC progress belong to stores or operation runners, independently of mounted tool pages. View navigation must preserve active scans, recordings, drafts and AI results; changing the underlying scan invalidates its AI recommendations. The notch animates its renderer surface for 240ms, then shrinks the native window after completion instead of resizing it every animation frame.

Transitions use `--duration-fast` (150ms) for controls and `--duration-normal` (260ms) for panels, with `--ease-out`. The global reduced-motion policy disables animation and transition duration; shared hover cards also stop moving. Responsive layouts preserve readable content and reachable actions at narrow window sizes.
