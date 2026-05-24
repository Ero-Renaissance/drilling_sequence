"""
Chart generation module for drilling sequence Gantt charts.

This module provides the ChartGenerator class that creates the main interactive Gantt chart
with features like responsive design, time navigation, and comprehensive styling.
"""

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

from .color_manager import ColorManager
from ..visualization.icon_positioner import IconPositioner


class ChartGenerator:
    """Main chart generation class"""
    
    def __init__(self, color_manager: ColorManager):
        self.color_manager = color_manager
        self.icon_positioner = IconPositioner(color_manager)
    
    def create_drilling_sequence_chart(self, df: pd.DataFrame) -> go.Figure:
        """Create the main Gantt chart"""
        
        # Build color mapping
        color_map = {}
        for activity in df['Activity Type'].unique():
            color_map[activity] = self.color_manager.get_activity_color(activity)
        
        # Create timeline chart
        fig = px.timeline(
            df, 
            x_start="Start Date", 
            x_end="End Date", 
            y="Composite Label",
            opacity=0.85,
            color="Activity Type",
            color_discrete_map=color_map,
            text="Well Name",
            hover_data={
                "Well Name": True,
                "Activity Type": True,
                "Start Date": True,
                "End Date": True,
                "Readiness Check Status": True,
                "Risk": True,
                "Comment": True,
                "Composite Label": False
            }
        )        
        
        # Configure bar appearance
        for trace in fig.data:
            trace.update(
                width=0.20,  # Make bars thinner to leave room for icons
                offsetgroup=0,  # Group bars at top of category space
                offset=-0.2  # Position bars slightly above center
            )
        
        # Setup custom hover templates
        self._setup_hover_templates(fig, df)
        
        # Calculate chart dimensions
        labels = df['Composite Label'].unique()
        chart_height = 900 + 50 * len(labels)
        
        # Configure text positioning
        fig.update_traces(
            textposition="inside",
            insidetextanchor="middle",
            insidetextfont=dict(size=14, color="white", family="Arial")
        )
        
        # Setup axes
        labels = df['Composite Label'].unique()
        start_date, end_date = self._get_date_range(df)
        self._configure_axes(fig, start_date, end_date, labels)
        
        # Get y-axis categories and add icons
        fig.update_layout(showlegend=False)  # Disable native legend (will use custom HTML legend)
        y_categories = fig.layout.yaxis.ticktext or labels
        self.icon_positioner.add_readiness_check_icons(fig, df, y_categories)
        
        # Apply patterns and styling
        self._apply_patterns(fig, df)
        
        # Configure layout
        self._configure_layout(fig, chart_height, start_date, end_date)
        
        # Add today's date line
        self._add_today_line(fig)
        
        # Add monthly time periods visualization
        self._add_monthly_time_periods(fig, start_date, end_date)
        
        return fig
    
    def _setup_hover_templates(self, fig: go.Figure, df: pd.DataFrame) -> None:
        """Configure hover templates for better data display"""
        
        for i, trace in enumerate(fig.data):
            fig.data[i].hovertemplate = (
                "<b>%{text}</b><br>" +
                "Activity: %{customdata[1]}<br>" +
                "Date: %{customdata[2]} to %{customdata[3]}<br>" +
                "Status: %{customdata[4]}" +
                "%{customdata[5]}" +
                "%{customdata[6]}" +
                "<extra></extra>"
            )
            
            # Build custom data
            trace_df = df[df["Activity Type"] == trace.name]
            customdata = []
            for _, row in trace_df.iterrows():
                risk = f"<br>Risk: {row['Risk']}" if pd.notna(row.get('Risk')) else ""
                comment = f"<br>Comment: {row['Comment']}" if pd.notna(row.get('Comment')) else ""
                
                customdata.append([
                    row['Well Name'], 
                    row['Activity Type'],
                    row['Start Date'].strftime('%Y-%m-%d'),
                    row['End Date'].strftime('%Y-%m-%d'),
                    row['Readiness Check Status'],
                    risk,
                    comment
                ])
            
            fig.data[i].customdata = customdata
    
    def _get_date_range(self, df: pd.DataFrame) -> Tuple[datetime, datetime]:
        """Calculate chart date range"""
        start_date = df['Start Date'].min().replace(day=1)
        end_date = df['End Date'].max()
        
        if end_date.month == 12:
            end_date = end_date.replace(year=end_date.year+1, month=1, day=1)
        else:
            end_date = end_date.replace(month=end_date.month+1, day=1)
            
        return start_date, end_date      
    
    def _configure_axes(self, fig: go.Figure, start_date: datetime, end_date: datetime, labels: List[str]) -> None:
        """Configure chart axes"""
        
        fig.update_yaxes(
            autorange="reversed",
            title=None,
            categoryorder='array',
            categoryarray=list(reversed(labels)),
            tickmode='array',
            tickvals=list(range(len(labels))),
            ticktext=list(reversed(labels)),
            ticklabelposition='outside top',
            ticklen=10,  # Length of tick marks
            ticklabelstandoff=20,   # Distance between tick labels and chart area
            automargin=True  # Automatically adjust margin to fit labels
        )
        
        fig.update_xaxes(
            tickformat='%b\n%Y',
            ticklabelmode='period',
            dtick='M1',
            tickangle=0,
            range=[start_date, end_date],
            automargin=True  # Automatically adjust margin to fit labels
        )
    
    def _apply_patterns(self, fig: go.Figure, df: pd.DataFrame) -> None:
        """Apply patterns to bars based on activity type or status"""
        
        for i, trace in enumerate(fig.data):
            activity_name = trace.name
            
            # Check for activity-specific patterns
            pattern_shape = ''
            pattern_color = '#4d4d4d'
            
            if activity_name in self.color_manager.activity_patterns:
                pattern_shape = self.color_manager.activity_patterns[activity_name]
                pattern_color = self.color_manager.activity_colors.get(activity_name, '#4d4d4d')
            else:
                # Use status-based patterns
                status_series = df[df['Activity Type'] == activity_name]['Readiness Check Status']
                if not status_series.empty:
                    status = status_series.iloc[0]
                    pattern_shape = self.color_manager.pattern_shapes.get(status, '')
                    pattern_color = self.color_manager.pattern_colors.get(status, '#4d4d4d')
                else:
                    # Default if no status found
                    pattern_shape = ''
                    pattern_color = '#4d4d4d'
            
            # Apply pattern if needed
            if pattern_shape:
                fig.data[i].marker.pattern = dict(
                    shape=pattern_shape,
                    fgcolor=pattern_color,
                    fgopacity=0.6,
                    fillmode='overlay'
                )    
    
    def _configure_layout(self, fig: go.Figure, chart_height: int, 
                         start_date: datetime, end_date: datetime) -> None:
        """Configure chart layout and styling with responsive design"""
        
        # Create time slider steps
        slider_steps = self._create_slider_steps(start_date, end_date)
        
        # Calculate responsive margins based on viewport
        # responsive_margins = self._get_responsive_margins() # Keep this line if you still want to use it as a base
        
        fig.update_layout(
            title={
                'text': "Drilling Operations Schedule & Readiness Dashboard",
                'font': {'size': 28, 'family': 'Roboto, Arial, sans-serif', 'weight': 'bold', 'color': '#1f4e79'},
                'y': 0.95, 
                'x': 0.5,
                'xanchor': 'center',
                'yanchor': 'top'
            },
            barmode='overlay',
            height=chart_height,          
            autosize=True,  # Ensure Plotly's responsive mode is enabled
            plot_bgcolor='white',
            showlegend=False,
            margin=dict(l=50, r=50, b=100, t=80, pad=4), # Adjusted base margins, automargin will further refine
            sliders=[dict(
                active=0,
                yanchor="top",
                xanchor="center",
                currentvalue=dict(
                    font=dict(size=12),
                    prefix="View Period: ",
                    visible=True,
                    xanchor="left"
                ),
                transition=dict(duration=300),
                pad=dict(b=15, t=50),
                len=0.9,
                x=0.5,
                y=-0.02,
                bgcolor="#f9f9f9",
                tickcolor="#d3d3d3",
                steps=slider_steps
            )]
        )
    
    def _create_slider_steps(self, start_date: datetime, end_date: datetime) -> List[Dict]:
        """Create time navigation slider steps"""
        
        slider_steps = []
        
        # Add "All" step
        slider_steps.append(dict(
            method="relayout",
            args=[{"xaxis.range": [start_date, end_date]}],
            label="All"
        ))
        
        # Calculate intervals
        total_months = (end_date.year - start_date.year) * 12 + end_date.month - start_date.month
        interval = max(3, total_months // 8)
        
        # Create time window steps
        time_points = pd.date_range(start=start_date, end=end_date, freq=f'{interval}MS')
        
        for i in range(len(time_points) - 1):
            range_start = time_points[i]
            
            if i == len(time_points) - 2:
                range_end = end_date
            else:
                range_end = time_points[i] + pd.DateOffset(months=interval*2)
                if range_end > end_date:
                    range_end = end_date
            
            step_label = f"{range_start.strftime('%b %Y')} - {range_end.strftime('%b %Y')}"
            
            slider_steps.append(dict(
                method="relayout",
                args=[{"xaxis.range": [range_start.strftime('%Y-%m-%d'), range_end.strftime('%Y-%m-%d')]}],
                label=step_label
            ))
        
        return slider_steps
    
    def _add_today_line(self, fig: go.Figure) -> None:
        """Add today's date indicator"""
        
        today_str = pd.Timestamp.now().strftime('%Y-%m-%d')
        
        fig.add_shape(
            type="line",
            x0=today_str,
            x1=today_str,
            y0=0,
            y1=1,
            xref="x",
            yref="paper",
            line=dict(color="red", width=2, dash="dash")
        )
        
        fig.add_annotation(
            x=today_str,
            y=1,
            text="Today",
            showarrow=False,
            font=dict(color="red"),
            yref="paper"
        )    
    
    def _calculate_dashboard_metrics(self, df: pd.DataFrame) -> dict:
        """Calculate dashboard KPI metrics for reuse in both annotations and HTML"""
        # Calculate summary metrics
        total_wells = df['Well Name'].nunique()
        total_rigs = df['Rig Name'].nunique()
        total_projects = df['Project'].nunique() if 'Project' in df.columns else 0
        
        # Get date range
        start_date = df['Start Date'].min()
        end_date = df['End Date'].max()
        date_range = f"{start_date.strftime('%b %d, %Y')} - {end_date.strftime('%b %d, %Y')}"
        
        # Calculate status metrics
        status_counts = df['Readiness Check Status'].value_counts() if 'Readiness Check Status' in df.columns else {}
        critical_issues = status_counts.get('Behind Schedule', 0)
        completed_checks = status_counts.get('Completed', 0)
        on_track = status_counts.get('Plan on track', 0)
        
        # Calculate contract expirations (if data available)
        contract_warnings = 0
        if 'Rig Contract Expiry Date' in df.columns:
            today = datetime.now()
            # Step 1: Get unique rig-contract combinations
            unique_contracts = df[df['Rig Contract Expiry Date'].notna()].drop_duplicates(['Rig Name', 'Rig Contract Expiry Date'])
            # Step 2: Calculate days to expiry for each unique rig
            unique_contracts['Days_to_Expiry'] = (pd.to_datetime(unique_contracts['Rig Contract Expiry Date']) - today).dt.days
            # Step 3: Filter for critical rigs (expiry within 90 days)
            critical_rigs = unique_contracts[unique_contracts['Days_to_Expiry'] <= 90]
            # Count critical rigs
            contract_warnings = len(critical_rigs)
        
        return {
            'total_wells': total_wells,
            'total_rigs': total_rigs,
            'total_projects': total_projects,
            'critical_issues': critical_issues,
            'contract_warnings': contract_warnings,
            'date_range': date_range,            
            'on_track': on_track,
            'completed_checks': completed_checks
        }
    
    def generate_sticky_kpi_html(self, df: pd.DataFrame) -> str:
        """Generate HTML for enhanced KPI dashboard with better screen utilization"""
        
        # Get metrics using the shared calculation method
        metrics = self._calculate_dashboard_metrics(df)
        
        # Generate colors for each metric
        critical_color = "#dc3545" if metrics['critical_issues'] > 0 else "#28a745"
        contract_color = "#ffc107" if metrics['contract_warnings'] > 0 else "#28a745"        
        
        kpi_html = f"""
        <div class="enhanced-kpi-dashboard" id="enhancedKpiDashboard">
            <div class="kpi-main-header">
                <div class="kpi-metrics-grid">
                    <div class="kpi-metric-card kpi-wells">
                        <div class="kpi-metric-content">
                            <div class="kpi-metric-value">{metrics['total_wells']}</div>
                            <div class="kpi-metric-label">Total Wells</div>
                        </div>
                    </div>
                    
                    <div class="kpi-metric-card kpi-rigs">
                        <div class="kpi-metric-content">
                            <div class="kpi-metric-value">{metrics['total_rigs']}</div>
                            <div class="kpi-metric-label">Active Rigs</div>
                        </div>
                    </div>
                    
                    <div class="kpi-metric-card kpi-critical">
                        <div class="kpi-metric-content">
                            <div class="kpi-metric-value">{metrics['critical_issues']}</div>
                            <div class="kpi-metric-label">Rigless Activities</div>
                        </div>
                    </div>
                    
                    <div class="kpi-metric-card kpi-contracts">
                        <div class="kpi-metric-content">
                            <div class="kpi-metric-value">{metrics['contract_warnings']}</div>
                            <div class="kpi-metric-label">Contract Alerts</div>
                            <div class="kpi-metric-sublabel">Expiring Soon</div>
                        </div>
                    </div>
                    
                    <div class="kpi-metric-card kpi-projects">
                        <div class="kpi-metric-content">
                            <div class="kpi-metric-value">{metrics['total_projects']}</div>
                            <div class="kpi-metric-label">Total Projects</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        """
        
        return kpi_html

    def _add_monthly_time_periods(self, fig: go.Figure, start_date: datetime, end_date: datetime) -> None:
        """Add monthly time period visualization with alternating background bands and vertical grid lines"""
        
        # Generate monthly boundaries
        current_date = start_date.replace(day=1)  # Start at beginning of month
        month_boundaries = []

        
        while current_date <= end_date:
            month_boundaries.append(current_date)
            # Move to next month
            if current_date.month == 12:
                current_date = current_date.replace(year=current_date.year + 1, month=1)
            else:
                current_date = current_date.replace(month=current_date.month + 1)
        
        # Add the end boundary if needed
        if month_boundaries[-1] < end_date:
            month_boundaries.append(end_date)
        
        # Add alternating background bands for months
        for i in range(len(month_boundaries) - 1):
            if i % 2 == 1:  # Every other month gets a light background
                fig.add_shape(
                    type="rect",
                    x0=month_boundaries[i],
                    x1=month_boundaries[i + 1],
                    y0=0,
                    y1=1,
                    fillcolor="rgba(180, 180, 180, 0.4)",  # Even darker gray with higher opacity
                    layer="below",
                    line=dict(width=0),
                    xref="x",
                    yref="paper"
                )
        
        # Add subtle vertical grid lines at month boundaries
        for boundary in month_boundaries[1:-1]:  # Skip first and last to avoid overlap with chart edges
            fig.add_shape(
                type="line",
                x0=boundary,
                x1=boundary,
                y0=0,
                y1=1,
                line=dict(
                    color="rgba(200, 200, 200, 0.4)",  # Light gray
                    width=1,
                    dash="dot"
                ),
                layer="below",
                xref="x",
                yref="paper"
            )          
        
        # Add month labels with responsive behavior
        for i in range(len(month_boundaries) - 1):
            if i % 2 == 1:  # Only label the alternating bands
                mid_date = month_boundaries[i] + (month_boundaries[i + 1] - month_boundaries[i]) / 2
                month_label = month_boundaries[i].strftime('%b %Y')  # Use abbreviated month names
                
                # Determine label priority for responsive behavior
                # Priority 1: Every other month (current desktop behavior)
                # Priority 2: Every 3rd month (tablet)
                # Priority 3: Quarterly (mobile)
                label_priority = 1 if i % 2 == 1 else (2 if i % 3 == 0 else 3)
                
                # Create CSS class for responsive visibility
                visibility_class = f"month-label-priority-{label_priority}"
                
                fig.add_annotation(
                    x=mid_date,
                    y=1.02,  # Slightly above the chart
                    text=f'<span class="{visibility_class} month-label" data-month-index="{i}" data-priority="{label_priority}">{month_label}</span>',
                    showarrow=False,
                    font=dict(
                        family="Roboto, Arial, sans-serif",
                        size=11,
                        color="rgba(60, 60, 60, 0.5)",
                        weight="bold"
                    ),
                    xref="x",
                    yref="paper",
                    xanchor="center",
                    yanchor="bottom")
                
    def _get_responsive_margins(self) -> Dict[str, int]:
        """Calculate responsive margins based on viewport size for optimal chart display"""
        
        # Base margins optimized for desktop viewing (reduced after removing embedded dashboard)
        base_margins = {
            't': 220,   # Top margin - space for title (significantly reduced)
            'b': 220,   # Bottom margin - space for slider and labels (significantly reduced)
            'l': 250,  # Left margin - space for y-axis labels (significantly reduced)
            'r': 180    # Right margin - space for annotations and scroll (significantly reduced)
        }
        
        # Additional margin configurations for different screen sizes
        # These will be applied through CSS media queries and JavaScript
        margin_configs = {
            'mobile': {
                't': 150,   # Reduced top margin for mobile
                'b': 150,   # Reduced bottom margin
                'l': 150,   # Smaller left margin
                'r': 100    # Smaller right margin
            },
            'tablet': {
                't': 170,   # Medium top margin for tablets
                'b': 170,   # Medium bottom margin
                'l': 180,   # Medium left margin
                'r': 120    # Medium right margin
            },
            'desktop': { # This was 'large' before, now represents standard desktop
                't': 200,   # Standard desktop top margin
                'b': 200,   # Standard desktop bottom margin
                'l': 220,  # Standard desktop left margin
                'r': 150    # Standard desktop right margin
            },
            # Removed 'large' as 'desktop' now serves as the larger screen default from base_margins
            'large': {
                't': 220,  # Large screen top margin (reduced from 280)
                'b': 220,  # Large screen bottom margin
                'l': 250,  # Large screen left margin
                'r': 180   # Large screen right margin
            }
        }
        
        # Return base margins (desktop configuration)
        # The responsive behavior will be handled by JavaScript and CSS
        return base_margins
