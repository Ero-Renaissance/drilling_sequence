/**
 * Tree-shaken ECharts build. The full `echarts` package (every chart type and
 * component) is ~1 MB; we only ever draw the Gantt (custom series) and the
 * rigs/spuds combo (bar + line), so we register just those pieces here and feed
 * this instance to `echarts-for-react/lib/core`. Keeps the bundle a fraction of the
 * wholesale import.
 *
 * If a chart starts using a new feature (a series type, dataZoom slider, markPoint,
 * graphic, visualMap…), register its component here or ECharts will warn at runtime
 * ("Component … is used but not imported") and silently skip it.
 */
import * as echarts from "echarts/core";
import { BarChart, CustomChart, LineChart } from "echarts/charts";
import {
  DataZoomInsideComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { LegacyGridContainLabel } from "echarts/features";

echarts.use([
  // Charts — CustomChart drives the Gantt (rect/text/image in renderItem);
  // BarChart + LineChart drive the rigs/well-spuds combo.
  CustomChart,
  BarChart,
  LineChart,
  // Components actually referenced by the two chart options.
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomInsideComponent,
  MarkLineComponent,
  CanvasRenderer,
  // Back-compat for `grid.containLabel: true` (auto-sizes the grid so long axis
  // labels — rig names, dates — aren't clipped). v6 made it a registerable feature;
  // the wholesale echarts import used to include it implicitly.
  LegacyGridContainLabel,
]);

export { echarts };
