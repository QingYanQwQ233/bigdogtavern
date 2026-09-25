# your design system — Component Patterns Reference

Source components: your design system's components directory (typically `components/`)

## Spec Table Format

All components document their properties in a consistent table format:

| Property | Value | Token |
|----------|-------|-------|
| Width | 220px | — |
| Background | #FAF8F5 | `--sds-nav-sidebar-bg` (warm-gray-025) |
| Border | 1px solid #E0DCD3 | `warm-gray-150` |

- First column: property name (sentence case, 500 weight)
- Second column: concrete value (px, hex, description)
- Third column: token reference or `—` if no token applies
- Token column uses `code` formatting

## State Definitions

Every interactive component must define these states:

### Required States
| State | Visual Pattern | Token Reference |
|-------|---------------|-----------------|
| Default | Base appearance | Component-specific |
| Hover | Background → warm-gray-050 (#F4F1EB), text darkens | Consistent across DS |
| Active/Pressed | Slightly darker than hover | Component-specific |
| Focus | 2px solid blue-750 outline, 2px offset | `--sds-border-focus` |
| Disabled | Gray text (#B0ABA2), `cursor: not-allowed` | `--sds-text-disabled` |

### Conditional States (for selectable items)
| State | Visual Pattern | Token Reference |
|-------|---------------|-----------------|
| Selected | blue-100 bg (#D9EBED) + blue-750 text (#013D5B), 500 weight | `--sds-nav-item-active-bg/text` |
| Selected + Hover | blue-150 bg (#C1DDE3) + blue-750 text | `blue-150` |

**Critical rule**: Selected state = light blue bg + dark text. NEVER dark bg + white text.

## Transition Conventions

| Context | Easing | Duration | Properties |
|---------|--------|----------|------------|
| Layout changes (resize, collapse) | `cubic-bezier(0.4, 0, 0.2, 1)` | 0.3s | width, height, padding, gap |
| Color/state feedback | `ease` | 0.15s | background, color, border-color |
| Quick hover | `ease` | 0.12s | background, color |
| Opacity changes | `ease` | 0.15-0.2s | opacity |

Always transition: `background`, `color`, `border-color`. Add `box-shadow` for buttons.

## Icon Conventions

| Property | Value |
|----------|-------|
| Style | Stroke-based (not filled) |
| Default size | 18 × 18px |
| Compact size | 16 × 16px |
| Large size | 20 × 20px |
| Stroke width | 1.5px |
| Stroke caps | `round` |
| Stroke joins | `round` |
| Fill | `none` (stroke only) |
| Default color | warm-gray-550 (#6B6760) |
| Hover color | warm-gray-700 (#47443F) |
| Active color | blue-750 (#013D5B) |

Icons are rendered as inline SVG with `viewBox="0 0 18 18"`.

## Button Patterns

### Variants
| Variant | Background | Text | Border | Use Case |
|---------|------------|------|--------|----------|
| Primary | blue-750 | white | blue-750 | Main CTA |
| Secondary | white | warm-gray-900 | warm-gray-800 | Secondary actions |
| Tertiary | transparent | blue-750 | none | Inline/text actions |
| Danger | red-500 | white | red-500 | Destructive actions |
| Danger Outlined | white | red-500 | red-500 | Less prominent destructive |

### Sizes
| Size | Height | Padding | Font | Radius | Icon |
|------|--------|---------|------|--------|------|
| Large | 48px | 12px 24px | 15px/500 | 8px | 18×18 |
| Medium | 40px | 10px 20px | 14px/500 | 6px | 16×16 |
| Small | 32px | 6px 14px | 13px/500 | 6px | 16×16 |

- Icon-label gap: 8px
- Icon-only buttons: square (width = height)
- Focus: 2px solid blue-750, 2px offset
- Border width: 1.5px
- Transition: `0.15s ease`

## Card Patterns

| Property | Value |
|----------|-------|
| Border radius | 8px |
| Border | 1px solid warm-gray-150 (#E0DCD3) |
| Shadow | `0 1px 3px rgba(0,0,0,0.06)` |
| Header padding | 16px 20px |
| Body padding | 16px 20px |
| Footer padding | 12px 20px |
| Title font | 14px, 600 weight |
| Small button font | 12px, 400 weight |

## Tab Patterns

### Page Tabs
- Padding: 12px 16px
- Font: 14px, 400 weight (500 when active)
- Default text: warm-gray-550
- Active: warm-gray-900 text + 2px blue-750 underline
- Badge: 20px height, warm-gray-100 bg, 12px font, 10px radius

### Toggle Tabs
- Container: warm-gray-050 bg, rounded
- Item padding: 6px 14px
- Font: 13px, 500 weight
- Active: white bg + blue-750 text

## Component Shell Pattern

Demo components are wrapped in a shell:
```
.demo-shell {
  border: 1px solid #E0DCD3;
  border-radius: 12px;
  overflow: hidden;
  background: #FFFFFF;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
```
