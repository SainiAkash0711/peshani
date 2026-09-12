/**
 * Chart series colors, taken verbatim from the dataviz skill's validated
 * default categorical palette (light mode - this admin app has no dark
 * theme). Assign colors to series in this fixed order; never cycle or
 * re-derive hues, and never let a filter that changes the series count
 * repaint the survivors.
 */
export const CHART_COLORS = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
];

/** Fixed, reserved status colors - never reused as a categorical series color. */
export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

export const CHART_CHROME = {
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  mutedText: '#898781',
};
