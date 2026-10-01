# Refract Protocol Responsive Breakpoint Matrix & Audit

## 1. Breakpoint Definitions

Refract Protocol defines a custom `xs` mobile breakpoint alongside standard Tailwind CSS viewport tiers:

| Token | Min Width | Target Devices / Form Factors | Primary Layout Strategy |
| :--- | :--- | :--- | :--- |
| **`base`** | `< 420px` (360px min) | Compact mobile (iPhone SE, Galaxy S-series small) | Single-column stacked; sticky disabled; full-width buttons; 44px tap targets |
| **`xs`** | `420px` | Standard mobile (iPhone 14/15/16, Pixel, Galaxy) | Compact 2-column stats; inline badge rows; horizontal stepper scrolling |
| **`sm`** | `640px` | Large mobile & phablets | 2-column cards; expanded quick-selection grids |
| **`md`** | `768px` | Tablets & small laptops | Top navigation expanded; 3-column / 4-column metric grids |
| **`lg`** | `1024px` | Desktop & Laptops | Multi-column split views (e.g. `grid-cols-[1fr_360px]`); sticky sidebar panels |
| **`xl`** | `1280px`+ | Large Displays | Centered container max `1200px` with generous side padding |

---

## 2. Page-by-Page Audit & Remediation Matrix

### 1. Landing Page (`/`)
- **Hero & Metrics**: Stacks to 1 column on `< 640px`, 2 columns on `sm`, 4 columns on `md`+.
- **Live Oracle Status Ticker**: Cards wrap gracefully with font-mono timestamps; values clamp on narrow viewports without horizontal scrolling.
- **Protocol Benefits Grid**: 1 column on mobile, 3 columns on `md`+.

### 2. Get Coverage (`/cover`)
- **Multi-Step Wizard**: Stepper navigation includes horizontal touch-scroll and compact badges on `< 640px`.
- **Right Quote / Status Panel**: Stacks below step flow on mobile/tablet; becomes sticky (`lg:sticky lg:top-20`) only at `lg` (1024px+).
- **Interactive Flight Grid**: 1 column on mobile (`< 640px`), 2 columns on `sm`+.
- **Touch Targets**: All radio cards, quick-amount buttons, and step triggers maintain minimum `44px` touch bounding boxes.

### 3. Provide Capital (`/provide`)
- **Stats Overview**: 2 columns on mobile, 4 columns on `sm`+.
- **Capital Allocation Canvas**: Centered on mobile; 2-column split with legend on `xs` (`420px`+).
- **Deposit/Withdraw Action Card**: Sticky on desktop (`lg:sticky lg:top-20`), stacked inline on mobile to avoid viewport overflow.
- **Utilization Bar & Subtitles**: Flex wraps to vertical on `< 420px` and horizontal on `xs`+.

### 4. Dashboard (`/dashboard`)
- **Portfolio Risk & Stat Cards**: 2 columns on mobile, 4 columns on `sm`+.
- **Policies & Claims Tables**: Horizontal scroll wrapper with subtle indicator on mobile to preserve financial precision without truncating transaction hashes or amounts.
- **Action Buttons**: Minimum touch target of 44px with clear focus outlines.

---

## 3. Responsive Quality Standards
1. **No Horizontal Scroll on Viewport**: All pages must maintain `overflow-x: hidden` at root container level.
2. **Accessible Tap Targets**: All interactive elements (buttons, inputs, tabs, radio items) must meet WCAG 2.1 AAA minimum target size (>= 44x44px) on touch viewports.
3. **Sticky Sidebar Safety**: Sticky sidebars must only activate at `lg` (`1024px`) or higher to prevent overlapping with content on mobile screens.
4. **Fluid Typography**: Headings clamp down cleanly from `28px` to `22px` on small screens without breaking line heights.
