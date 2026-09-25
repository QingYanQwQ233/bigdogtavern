# your design system — Token Reference

Full token definitions: your design system's color tokens (typically `tokens/colors.css`)
Design conventions: your design system's CLAUDE.md or README

## Semantic Tokens

### Background
| Token | Light Value | Usage |
|-------|-------------|-------|
| `--sds-bg-page` | white | Page background |
| `--sds-bg-surface` | warm-gray-025 (#FAF8F5) | Sidebars, panels |
| `--sds-bg-card` | white | Card backgrounds |
| `--sds-bg-elevated` | white | Modals, popovers |
| `--sds-bg-subtle` | warm-gray-050 (#F4F1EB) | Table headers, empty states |

### Text
| Token | Light Value | Usage |
|-------|-------------|-------|
| `--sds-text-primary` | warm-gray-900 (#1C1A17) | Headings, high emphasis |
| `--sds-text-secondary` | warm-gray-650 (#54514D) | Body copy |
| `--sds-text-tertiary` | warm-gray-550 (#6B6760) | Placeholders, captions |
| `--sds-text-disabled` | warm-gray-300 (#B0ABA2) | Disabled text |
| `--sds-text-on-primary` | white | Text on primary backgrounds |
| `--sds-text-link` | blue-750 (#013D5B) | Links |

### Border
| Token | Light Value | Usage |
|-------|-------------|-------|
| `--sds-border-default` | warm-gray-150 (#E0DCD3) | Default borders |
| `--sds-border-subtle` | warm-gray-100 (#EBE6DD) | Subtle separators |
| `--sds-border-strong` | warm-gray-200 (#D0CBC3) | Emphasized borders |
| `--sds-border-focus` | blue-750 (#013D5B) | Focus rings |

### Interactive
| Token | Light Value | Usage |
|-------|-------------|-------|
| `--sds-interactive-primary` | blue-750 (#013D5B) | Primary buttons, active states |
| `--sds-interactive-primary-hover` | blue-800 (#05314D) | Hover |
| `--sds-interactive-primary-active` | blue-850 (#032740) | Active/pressed |
| `--sds-interactive-primary-subtle` | blue-100 (#D9EBED) | Light backgrounds |
| `--sds-interactive-secondary` | white | Secondary button bg |
| `--sds-interactive-secondary-border` | warm-gray-800 (#302D28) | Secondary button border |

### Navigation
| Token | Light Value | Usage |
|-------|-------------|-------|
| `--sds-nav-sidebar-bg` | warm-gray-025 (#FAF8F5) | Sidebar background |
| `--sds-nav-item-active-bg` | blue-100 (#D9EBED) | Active nav item bg |
| `--sds-nav-item-active-text` | blue-750 (#013D5B) | Active nav item text |
| `--sds-nav-item-text` | warm-gray-650 (#54514D) | Default nav item text |
| `--sds-nav-section-header` | warm-gray-550 (#6B6760) | Group label text |

### Status
| Category | Background | Text | Strong |
|----------|------------|------|--------|
| Success | `--sds-status-success-bg` (green-025) | `--sds-status-success-text` (green-500) | green-400 |
| Warning | `--sds-status-warning-bg` (yellow-025) | `--sds-status-warning-text` (yellow-500) | yellow-200 |
| Error | `--sds-status-error-bg` (red-050) | `--sds-status-error-text` (red-500) | red-450 |
| Info | `--sds-status-info-bg` (blue-050) | `--sds-status-info-text` (blue-700) | — |
| Neutral | `--sds-status-neutral-bg` (warm-gray-100) | `--sds-status-neutral-text` (warm-gray-650) | — |
| Purple | #F7EEFF | purple-550 (#805AA1) | — |

## Design Conventions

### Typography
- **Font stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Rendering**: `-webkit-font-smoothing: antialiased`

### Spacing & Dimensions
- **Base grid**: 8px
- **Border radius**: 6px (small/buttons), 8px (components), 12px (cards/shells)
- **Icon sizes**: 16×16 (compact), 18×18 (default), 20×20 (large)
- **Gaps**: 8px (most), 10px (icon+label), 12px (sections), 16px+ (major sections)

### Transitions
- **Layout animations**: `cubic-bezier(0.4, 0, 0.2, 1)` — 0.3s duration
- **State changes**: `0.15s ease` (background, color, border)
- **Quick state**: `0.12s ease` (hover/active feedback)

### Interactive Patterns
- **Hover bg**: warm-gray-050 (#F4F1EB) — consistent everywhere
- **Active/selected**: blue-100 bg + blue-750 text — NEVER dark bg + white text
- **Focus ring**: 2px solid blue-750, 2px offset
- **Disabled**: Reduced opacity/gray, `cursor: not-allowed`
- **Card shadow**: `0 1px 3px rgba(0,0,0,0.06)`

### Dark Mode
Handled automatically via `@media (prefers-color-scheme: dark)`:
- Warm grays → cool grays
- Backgrounds darken (page → cool-gray-950, surface → cool-gray-900)
- Text lightens (primary → cool-gray-025, secondary → cool-gray-300)
- Borders darken (default → cool-gray-750)
- Use semantic tokens and dark mode works automatically
