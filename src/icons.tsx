import type { IconName, IconProps, IconRenderer, Icons } from "./types"

/**
 * 既定アイコン（最小インライン SVG）。FontAwesome 等の外部依存を持たない。
 * `icons` prop で個別に差し替えられる。
 */

const svgProps = (props: IconProps) => ({
    width: props.size ?? 14,
    height: props.size ?? 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: props.className,
    "aria-hidden": true,
})

const SortAscending: IconRenderer = (props) => (
    <svg {...svgProps(props)}>
        <path d="M8 12V4M8 4l-3 3M8 4l3 3" />
    </svg>
)

const SortDescending: IconRenderer = (props) => (
    <svg {...svgProps(props)}>
        <path d="M8 4v8M8 12l-3-3M8 12l3-3" />
    </svg>
)

const SortUnsorted: IconRenderer = (props) => (
    <svg {...svgProps(props)} opacity={0.45}>
        <path d="M5 6l3-3 3 3M5 10l3 3 3-3" />
    </svg>
)

const Filter: IconRenderer = (props) => (
    <svg {...svgProps(props)}>
        <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.3v-5.3z" />
    </svg>
)

const FilterActive: IconRenderer = (props) => (
    <svg {...svgProps(props)} fill="currentColor" stroke="none">
        <path d="M2.5 3.5h11l-4.2 5v4l-2.6 1.3v-5.3z" />
    </svg>
)

export const DEFAULT_ICONS: Record<IconName, IconRenderer> = {
    sortAscending: SortAscending,
    sortDescending: SortDescending,
    sortUnsorted: SortUnsorted,
    filter: Filter,
    filterActive: FilterActive,
}

export const resolveIcons = (overrides?: Icons): Record<IconName, IconRenderer> =>
    overrides ? { ...DEFAULT_ICONS, ...overrides } : DEFAULT_ICONS
