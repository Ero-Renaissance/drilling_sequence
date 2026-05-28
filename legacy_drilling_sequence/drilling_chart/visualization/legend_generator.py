"""
Legend generation module for drilling sequence Gantt charts.

This module provides the LegendGenerator class that creates comprehensive HTML legends
with responsive scaling, collapsible functionality, and interactive features for the chart.
"""

import pandas as pd
from typing import Dict
from ..core.color_manager import ColorManager


class LegendGenerator:
    """Generates custom HTML legend for the Gantt chart"""
    
    def __init__(self, color_manager: ColorManager):
        self.color_manager = color_manager    

    def generate_legend_html(self, df: pd.DataFrame, chart_width: int = None) -> str:
        """Generate comprehensive HTML legend with responsive scaling and collapsible functionality"""
        
        # Calculate responsive legend styling based on chart width
        legend_styles = self._calculate_responsive_styles(chart_width)
        
        # Get unique values from data
        activity_types = sorted(df['Activity Type'].unique())
        
        # Handle status values - filter out NaN values before sorting
        if 'Readiness Check Status' in df.columns:
            status_series = df['Readiness Check Status'].dropna()
            status_values = sorted(status_series.unique()) if not status_series.empty else []
        else:
            status_values = []
        
        # Handle plan types - filter out NaN values before sorting  
        if 'Plan Type' in df.columns:
            plan_type_series = df['Plan Type'].dropna()
            plan_types = sorted(plan_type_series.unique()) if not plan_type_series.empty else []
        else:
            plan_types = []
        
        # Enhanced legend with collapsible functionality and improved UI
        legend_html = f"""
        <div id="legend-main" style="font-family: 'Roboto', Arial, sans-serif; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; border: 1px solid #dee2e6; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin: {legend_styles['margin']}px;">
            <!-- Legend Header with Controls -->
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 12px 20px; border-bottom: 1px solid #dee2e6; background: linear-gradient(90deg, #495057 0%, #6c757d 100%); border-radius: 12px 12px 0 0; color: white;">
                <h2 style="margin: 0; font-size: {legend_styles['header_font_size'] + 2}px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.1);">Chart Legend</h2>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <!-- Size Control Buttons -->
                    <div style="display: flex; background: rgba(255,255,255,0.15); border-radius: 6px; padding: 2px;">
                        <button id="legend-compact" onclick="setLegendSize('compact')" 
                                style="background: none; border: none; color: white; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.2s;" 
                                onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='none'">
                            Compact
                        </button>
                        <button id="legend-normal" onclick="setLegendSize('normal')" 
                                style="background: rgba(255,255,255,0.25); border: none; color: white; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.2s;">
                            Normal
                        </button>
                        <button id="legend-detailed" onclick="setLegendSize('detailed')" 
                                style="background: none; border: none; color: white; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.2s;" 
                                onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='none'">
                            Detailed
                        </button>
                    </div>
                    <!-- Collapse Toggle Button -->
                    <button id="legend-toggle" onclick="toggleLegend()" 
                            style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                        ▲ Collapse
                    </button>
                </div>
            </div>
            
            <!-- Legend Content -->
            <div id="legend-content" style="display: flex; gap: {legend_styles['gap']}px; padding: {legend_styles['padding']}px; {legend_styles['layout']} transition: all 0.3s ease-in-out;">
                <!-- Activity Types Column -->
                <div style="flex: 1; min-width: {legend_styles['column_min_width']}px;">
                    <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: {legend_styles['header_font_size']}px; display: flex; align-items: center;">
                        <span style="background: linear-gradient(45deg, #007bff, #0056b3); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">🔧</span>
                        &nbsp;Activity Types
                    </h3>
                    <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add activity types
        for activity in activity_types:
            color = self.color_manager.get_activity_color(activity)
            legend_html += f"""
                    <tr>
                        <td style="padding: 4px 8px; width: 20px;">
                            <div style="width: {legend_styles['icon_size']}px; height: {legend_styles['icon_height']}px; background-color: {color}; border: 1px solid #333; border-radius: 2px;"></div>
                        </td>
                        <td style="padding: 4px 8px; font-size: {legend_styles['text_font_size']}px; color: #495057;">{activity}</td>
                    </tr>
            """
        
        legend_html += """
                </table>
            </div>
              <!-- Readiness Check Icons Column -->
            <div style="flex: 1; min-width: """ + str(legend_styles['column_min_width']) + """px;">
                <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: """ + str(legend_styles['header_font_size']) + """px; display: flex; align-items: center;">
                    <span style="background: linear-gradient(45deg, #28a745, #20c997); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">✓</span>
                    &nbsp;Readiness Check Icons
                </h3>
                <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add readiness check icons
        readiness_checks = self.color_manager.readiness_check_icons
        for check_name, check_config in sorted(readiness_checks.items(), key=lambda x: x[1].get('position', 0)):
            symbol = self._get_unicode_symbol(check_config.get('symbol', 'circle'))
            legend_html += f"""
                    <tr>
                        <td style="padding: 4px 8px; width: 20px; text-align: center; font-size: {legend_styles['symbol_font_size']}px; color: #333;">
                            {symbol}
                        </td>
                        <td style="padding: 4px 8px; font-size: {legend_styles['text_font_size']}px; color: #495057;"><strong>{check_name}</strong></td>
                    </tr>
            """
        
        legend_html += """
                </table>
            </div>
              <!-- Status & Plan Type Column -->
            <div style="flex: 1; min-width: """ + str(legend_styles['column_min_width']) + """px;">
                <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: """ + str(legend_styles['header_font_size']) + """px; display: flex; align-items: center;">
                    <span style="background: linear-gradient(45deg, #6f42c1, #e83e8c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">📊</span>
                    &nbsp;Status &amp; Plan Types
                </h3>
                
                <!-- Status Colors -->
                <h4 style="margin: 15px 0 8px 0; color: #6c757d; font-size: """ + str(legend_styles['subheader_font_size']) + """px; display: flex; align-items: center;">
                    <span style="margin-right: 6px;">🎨</span>Status Colors:
                </h4>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
        """
        
        # Add status colors
        status_colors = self.color_manager.pattern_colors
        for status, color in status_colors.items():
            if status in status_values:  # Only show statuses that exist in data
                legend_html += f"""
                        <tr>
                            <td style="padding: 2px 8px; width: 20px;">
                                <div style="width: {legend_styles['icon_size']}px; height: {legend_styles['status_icon_height']}px; background-color: {color}; border: 1px solid #333; border-radius: 1px;"></div>
                            </td>
                            <td style="padding: 2px 8px; font-size: {legend_styles['small_text_font_size']}px; color: #495057;">{status}</td>
                        </tr>
                """
        
        legend_html += """
                </table>
                  <!-- Plan Type Icons -->
                <h4 style="margin: 15px 0 8px 0; color: #6c757d; font-size: """ + str(legend_styles['subheader_font_size']) + """px; display: flex; align-items: center;">
                    <span style="margin-right: 6px;">📋</span>Plan Types:
                </h4>
                <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add plan type icons
        plan_type_icons = self.color_manager.plan_type_icons
        for plan_type in plan_types:
            if plan_type in plan_type_icons:
                config = plan_type_icons[plan_type]
                color = config.get('color', '#333')
                legend_html += f"""
                        <tr>
                            <td style="padding: 2px 8px; width: 20px;">
                                <div style="width: {legend_styles['plan_icon_width']}px; height: {legend_styles['status_icon_height']}px; background-color: {color}; border: 1px solid #333; border-radius: 1px;"></div>
                            </td>
                            <td style="padding: 2px 8px; font-size: {legend_styles['small_text_font_size']}px; color: #495057;">{plan_type}</td>
                        </tr>
                """
        
        legend_html += """
                </table>            </div>            <!-- Contract Expiration Column -->
            <div style="flex: 1; min-width: """ + str(legend_styles['column_min_width']) + """px;">
                <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: """ + str(legend_styles['header_font_size']) + """px; display: flex; align-items: center;">
                    <span style="background: linear-gradient(45deg, #dc3545, #fd7e14); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">⏰</span>
                    &nbsp;Contract Expiration
                </h3>
                <table style="width: 100%; border-collapse: collapse;">"""
        
        # Get the clock symbol using HTML entity
        clock_symbol = self._get_unicode_symbol('clock')
        legend_html += f"""
                    <tr>
                        <td style="padding: 4px 8px; width: 20px; text-align: center; font-size: {legend_styles['symbol_font_size']}px; color: #dc3545;">
                            {clock_symbol}
                        </td>
                        <td style="padding: 4px 8px; font-size: {legend_styles['text_font_size']}px; color: #495057;"><strong>Contract Expiry</strong></td>
                    </tr>
                </table>
                  <h4 style="margin: 15px 0 8px 0; color: #6c757d; font-size: {legend_styles['subheader_font_size']}px; display: flex; align-items: center;">
                    <span style="margin-right: 6px;">🚨</span>Urgency Levels:
                </h4>
                <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add contract expiration urgency levels with colored indicators
        urgency_colors = self.color_manager.contract_expiration_icons.get('urgency_colors', {})
        urgency_labels = {
            'expired': 'Expired',
            'critical': '< 30 days',
            'warning': '30-90 days', 
            'good': '90+ days'
        }
        
        for urgency, color in urgency_colors.items():
            label = urgency_labels.get(urgency, urgency.title())
            legend_html += f"""
                    <tr>
                        <td style="padding: 2px 8px; width: 20px; text-align: center;">
                            <div style="width: {legend_styles['urgency_icon_size']}px; height: {legend_styles['urgency_icon_size']}px; background-color: {color}; border: 1px solid #333; border-radius: 50%; margin: auto;"></div>
                        </td>                        <td style="padding: 2px 8px; font-size: {legend_styles['small_text_font_size']}px; color: #495057;">{label}</td>
                    </tr>
            """
        legend_html += """
                </table>
            </div>
        </div>
        
        <!-- Legend JavaScript for Interactive Features -->        <script>
            let legendState = 'normal';
            let isCollapsed = true; // Start collapsed by default
            
            function toggleLegend() {
                const content = document.getElementById('legend-content');
                const button = document.getElementById('legend-toggle');
                
                if (isCollapsed) {
                    content.style.display = 'flex';
                    button.innerHTML = '▲ Collapse';
                    button.style.background = 'rgba(255,255,255,0.15)';
                    isCollapsed = false;
                } else {
                    content.style.display = 'none';
                    button.innerHTML = '▼ Expand';
                    button.style.background = 'rgba(40, 167, 69, 0.8)';
                    isCollapsed = true;
                }
            }
            
            function setLegendSize(size) {
                const content = document.getElementById('legend-content');
                const buttons = ['legend-compact', 'legend-normal', 'legend-detailed'];
                
                // Reset all button styles
                buttons.forEach(id => {
                    const btn = document.getElementById(id);
                    btn.style.background = 'none';
                    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.onmouseout = () => btn.style.background = 'none';
                });
                
                // Set active button style
                const activeBtn = document.getElementById('legend-' + size);
                activeBtn.style.background = 'rgba(255,255,255,0.25)';
                activeBtn.onmouseover = null;
                activeBtn.onmouseout = null;
                
                // Apply size-specific styles
                switch(size) {
                    case 'compact':
                        content.style.padding = '12px';
                        content.style.gap = '15px';
                        content.style.fontSize = '11px';
                        content.querySelectorAll('h3').forEach(h => h.style.fontSize = '14px');
                        content.querySelectorAll('h4').forEach(h => h.style.fontSize = '12px');
                        break;
                    case 'normal':
                        content.style.padding = '20px';
                        content.style.gap = '25px';
                        content.style.fontSize = '12px';
                        content.querySelectorAll('h3').forEach(h => h.style.fontSize = '16px');
                        content.querySelectorAll('h4').forEach(h => h.style.fontSize = '14px');
                        break;
                    case 'detailed':
                        content.style.padding = '28px';
                        content.style.gap = '35px';
                        content.style.fontSize = '13px';
                        content.querySelectorAll('h3').forEach(h => h.style.fontSize = '18px');
                        content.querySelectorAll('h4').forEach(h => h.style.fontSize = '15px');
                        break;
                }
                legendState = size;
            }
              // Initialize with normal size and collapsed state
            document.addEventListener('DOMContentLoaded', function() {
                setLegendSize('normal');
                // Start collapsed by default
                const content = document.getElementById('legend-content');
                const button = document.getElementById('legend-toggle');
                content.style.display = 'none';
                button.innerHTML = '▼ Expand';
                button.style.background = 'rgba(40, 167, 69, 0.8)';
            });
            
            // Auto-collapse on small screens
            function checkScreenSize() {
                if (window.innerWidth < 768 && !isCollapsed) {
                    toggleLegend();
                }
            }
            
            window.addEventListener('resize', checkScreenSize);
            window.addEventListener('load', checkScreenSize);
        </script>
    </div>        """        
        return legend_html
    
    def _calculate_responsive_styles(self, chart_width: int = None) -> Dict[str, int]:
        """Calculate responsive styling for legend based on chart width"""
        if chart_width is None:
            # Default values when chart width is not provided - Ultra compact (matching signature generator)
            return {
                'gap': 6,
                'margin': 8,
                'padding': 8,
                'column_min_width': 160,
                'header_font_size': 14,
                'subheader_font_size': 12,
                'text_font_size': 10,
                'small_text_font_size': 8,
                'symbol_font_size': 12,
                'icon_size': 16,
                'icon_height': 12,
                'status_icon_height': 12,
                'plan_icon_width': 12,
                'urgency_icon_size': 10,
                'layout': ''  # No flex-wrap for normal size
            }
          # Responsive scaling based on chart width
        if chart_width < 1200:  # Small screens
            return {
                'gap': 6,
                'margin': 6,
                'padding': 6,
                'column_min_width': 120,
                'header_font_size': 10,
                'subheader_font_size': 9,
                'text_font_size': 8,
                'small_text_font_size': 7,
                'symbol_font_size': 8,
                'icon_size': 12,
                'icon_height': 6,
                'status_icon_height': 4,
                'plan_icon_width': 6,
                'urgency_icon_size': 6,               
                'layout': 'flex-wrap: wrap;'  # Stack columns on very small screens
            }
        elif chart_width < 2000:  # Medium screens
            return {
                'gap': 8,
                'margin': 10,
                'padding': 10,
                'column_min_width': 150,
                'header_font_size': 12,
                'subheader_font_size': 10,
                'text_font_size': 9,
                'small_text_font_size': 8,
                'symbol_font_size': 10,
                'icon_size': 16,
                'icon_height': 9,
                'status_icon_height': 6,
                'plan_icon_width': 9,
                'urgency_icon_size': 9,                
                'layout': ''
            }
        else:  # Large screens
            return {
                'gap': 12,
                'margin': 15,
                'padding': 12,
                'column_min_width': 180,
                'header_font_size': 14,
                'subheader_font_size': 12,
                'text_font_size': 11,
                'small_text_font_size': 10,
                'symbol_font_size': 12,
                'icon_size': 18,
                'icon_height': 10,
                'status_icon_height': 10,
                'plan_icon_width': 10,
                'urgency_icon_size': 10,
                'layout': ''
            }

    def _get_unicode_symbol(self, symbol_name: str) -> str:
        """Convert symbol names to HTML entities for better browser compatibility"""
        symbol_map = {
            'diamond': '&#9830;',    # ♦
            'square': '&#9632;',     # ■ 
            'triangle-up': '&#9650;', # ▲
            'star': '&#9733;',       # ★
            'hexagon': '&#11042;',   # ⬢
            'circle': '&#9679;',     # ●
            'cross': '&#10005;',     # ✕
            'clock': '&#9200;'       # ⏰
        }
        return symbol_map.get(symbol_name, '&#9679;')
