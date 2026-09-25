# your design system — Design Review Checklist

## Raw Hex → Semantic Token Mapping

When auditing code, flag these raw hex values and suggest the semantic token:

### Backgrounds
| Raw Hex | Token | Name |
|---------|-------|------|
| `#FFFFFF` (as page bg) | `var(--sds-bg-page)` | white |
| `#FAF8F5` (as surface) | `var(--sds-bg-surface)` | warm-gray-025 |
| `#FFFFFF` (as card bg) | `var(--sds-bg-card)` | white |
| `#F4F1EB` (as subtle bg) | `var(--sds-bg-subtle)` | warm-gray-050 |

### Text Colors
| Raw Hex | Token | Name |
|---------|-------|------|
| `#1C1A17` | `var(--sds-text-primary)` | warm-gray-900 |
| `#54514D` | `var(--sds-text-secondary)` | warm-gray-650 |
| `#6B6760` | `var(--sds-text-tertiary)` | warm-gray-550 |
| `#B0ABA2` | `var(--sds-text-disabled)` | warm-gray-300 |
| `#013D5B` (as link) | `var(--sds-text-link)` | blue-750 |

### Borders
| Raw Hex | Token | Name |
|---------|-------|------|
| `#E0DCD3` | `var(--sds-border-default)` | warm-gray-150 |
| `#EBE6DD` | `var(--sds-border-subtle)` | warm-gray-100 |
| `#D0CBC3` | `var(--sds-border-strong)` | warm-gray-200 |
| `#013D5B` (as focus) | `var(--sds-border-focus)` | blue-750 |

### Interactive
| Raw Hex | Token | Name |
|---------|-------|------|
| `#013D5B` (as button bg) | `var(--sds-interactive-primary)` | blue-750 |
| `#05314D` | `var(--sds-interactive-primary-hover)` | blue-800 |
| `#032740` | `var(--sds-interactive-primary-active)` | blue-850 |
| `#D9EBED` | `var(--sds-interactive-primary-subtle)` | blue-100 |
| `#302D28` | `var(--sds-interactive-secondary-border)` | warm-gray-800 |

### Navigation
| Raw Hex | Token | Name |
|---------|-------|------|
| `#FAF8F5` (as sidebar) | `var(--sds-nav-sidebar-bg)` | warm-gray-025 |
| `#D9EBED` (as active nav) | `var(--sds-nav-item-active-bg)` | blue-100 |
| `#013D5B` (as active nav text) | `var(--sds-nav-item-active-text)` | blue-750 |

### Status Colors
| Raw Hex | Token | Context |
|---------|-------|---------|
| `#F4FAEB` | `var(--sds-status-success-bg)` | Success background |
| `#62800B` | `var(--sds-status-success-text)` | Success text |
| `#FCF9D9` | `var(--sds-status-warning-bg)` | Warning background |
| `#8A7515` | `var(--sds-status-warning-text)` | Warning text |
| `#FFEEEB` | `var(--sds-status-error-bg)` | Error background |
| `#BF5547` | `var(--sds-status-error-text)` | Error text |
| `#EBF4F5` | `var(--sds-status-info-bg)` | Info background |
| `#0C4A69` | `var(--sds-status-info-text)` | Info text |

## Quick Audit Checklist

### Critical
- [ ] No raw hex colors where semantic tokens exist
- [ ] All interactive elements have ARIA labels
- [ ] Color contrast meets 4.5:1 for text, 3:1 for UI elements
- [ ] All focusable elements have visible focus styles
- [ ] Keyboard navigation works for all interactive elements

### Major
- [ ] All spacing values are multiples of 8px
- [ ] Border radius uses standard values: 6px, 8px, or 12px
- [ ] Interactive elements have hover, active, focus, and disabled states
- [ ] Dark mode supported (semantic tokens used, or explicit `prefers-color-scheme`)
- [ ] Active/selected states use light bg (blue-100) + dark text (blue-750), never inverted

### Minor
- [ ] Font stack matches: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- [ ] `-webkit-font-smoothing: antialiased` applied
- [ ] Layout transitions use `cubic-bezier(0.4, 0, 0.2, 1)`
- [ ] State transitions use `0.15s ease` or `0.12s ease`
- [ ] Hover backgrounds use warm-gray-050 (#F4F1EB)
- [ ] Icons are stroke-based, 18×18px, 1.5px stroke-width
