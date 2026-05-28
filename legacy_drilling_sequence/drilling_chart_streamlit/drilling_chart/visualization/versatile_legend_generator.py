"""
Versatile legend generation module for timeline charts.

This module provides a flexible LegendGenerator that adapts to any timeline data
while maintaining backward compatibility with drilling-specific functionality.
"""

import pandas as pd
from typing import Dict, List, Optional, Tuple
from ..core.color_manager import ColorManager


class VersatileLegendGenerator:
    """Generates adaptive HTML legends that work with any timeline data"""
    
    def __init__(self, color_manager: ColorManager, legend_config: Optional[Dict] = None):
        self.color_manager = color_manager
        self.legend_config = legend_config or self._get_default_config()

    def _get_default_config(self) -> Dict:
        """Get default legend configuration that adapts to data type"""
        return {
            'terminology': {
                'activity_section': 'Activity Types',
                'status_section': 'Status Colors',
                'milestone_section': 'Milestones',
                'plan_section': 'Plan Types',
                'expiry_section': 'Important Dates'
            },
            'icons': {
                'activity': '🔧',
                'status': '🎨', 
                'milestone': '✓',
                'plan': '📋',
                'expiry': '⏰'
            },
            'sections': {
                'show_activity_types': True,
                'show_milestones': True,
                'show_status_colors': True,
                'show_plan_types': True,
                'show_expiry_warnings': True
            }
        }

    def _detect_data_type(self, df: pd.DataFrame) -> str:
        """Detect if this is drilling data or generic timeline data"""
        drilling_indicators = [
            'Rig Name', 'Well Name', 'Readiness Check Status', 
            'Rig Contract Expiry Date', 'Location'
        ]
        
        drilling_score = sum(1 for col in drilling_indicators if col in df.columns)
        return 'drilling' if drilling_score >= 3 else 'generic'

    def _adapt_terminology(self, data_type: str, df: pd.DataFrame) -> Dict:
        """Adapt terminology based on data type and available columns"""
        if data_type == 'drilling':
            return {
                'activity_section': 'Activity Types',
                'milestone_section': 'Readiness Check Icons',
                'status_section': 'Status & Plan Types',
                'plan_section': 'Plan Types',
                'expiry_section': 'Contract Expiration'
            }
        else:
            # Generic terminology that works with any timeline data
            terminology = dict(self.legend_config['terminology'])
            
            # Adapt milestone section name based on available columns
            if 'Milestone' in df.columns:
                terminology['milestone_section'] = 'Milestones'
            elif 'Checkpoint' in df.columns:
                terminology['milestone_section'] = 'Checkpoints'
            elif 'Gate' in df.columns:
                terminology['milestone_section'] = 'Gates'
            elif any('Check' in col for col in df.columns):
                terminology['milestone_section'] = 'Checks'
            else:
                terminology['milestone_section'] = 'Markers'
            
            return terminology

    def _get_milestone_column(self, df: pd.DataFrame) -> Optional[str]:
        """Find the column that contains milestone/checkpoint data"""
        milestone_candidates = [
            'Readiness Check', 'Milestone', 'Checkpoint', 'Gate', 
            'Marker', 'Review Point', 'Decision Point'
        ]
        
        for candidate in milestone_candidates:
            if candidate in df.columns:
                return candidate
        return None

    def _get_milestone_status_column(self, df: pd.DataFrame) -> Optional[str]:
        """Find the column that contains milestone status data"""
        status_candidates = [
            'Readiness Check Status', 'Milestone Status', 'Checkpoint Status',
            'Gate Status', 'Status', 'State', 'Progress'
        ]
        
        for candidate in status_candidates:
            if candidate in df.columns:
                return candidate
        return None

    def _get_plan_type_column(self, df: pd.DataFrame) -> Optional[str]:
        """Find the column that contains plan type data"""
        plan_candidates = [
            'Plan Type', 'Plan Category', 'Type', 'Category',
            'Classification', 'Priority', 'Phase'
        ]
        
        for candidate in plan_candidates:
            if candidate in df.columns:
                return candidate
        return None

    def _get_expiry_column(self, df: pd.DataFrame) -> Optional[str]:
        """Find the column that contains expiry/deadline data"""
        expiry_candidates = [
            'Rig Contract Expiry Date', 'Contract Expiry', 'Expiry Date',
            'Deadline', 'Due Date', 'Target Date', 'End Date'
        ]
        
        for candidate in expiry_candidates:
            if candidate in df.columns and candidate != 'End Date':  # Exclude main End Date
                return candidate
        return None

    def generate_legend_html(self, df: pd.DataFrame, chart_width: int = None) -> str:
        """Generate adaptive HTML legend based on available data"""
        
        # Detect data type and adapt configuration
        data_type = self._detect_data_type(df)
        terminology = self._adapt_terminology(data_type, df)
        
        # Calculate responsive legend styling
        legend_styles = self._calculate_responsive_styles(chart_width)
        
        # Determine what sections to show based on available data
        sections_to_show = self._determine_sections(df)
        
        # Start building the legend
        legend_html = self._build_legend_header(legend_styles, terminology)
        legend_html += self._build_legend_content_start(legend_styles)
        
        # Build each section dynamically
        column_count = 0
        max_columns = 4
        
        if sections_to_show['activity_types']:
            legend_html += self._build_activity_types_section(df, legend_styles, terminology)
            column_count += 1
        
        if sections_to_show['milestones'] and column_count < max_columns:
            legend_html += self._build_milestones_section(df, legend_styles, terminology)
            column_count += 1
        
        if sections_to_show['status_plan'] and column_count < max_columns:
            legend_html += self._build_status_plan_section(df, legend_styles, terminology)
            column_count += 1
        
        if sections_to_show['expiry_warnings'] and column_count < max_columns:
            legend_html += self._build_expiry_section(df, legend_styles, terminology)
            column_count += 1
        
        # Close the legend
        legend_html += self._build_legend_footer()
        
        return legend_html

    def _determine_sections(self, df: pd.DataFrame) -> Dict[str, bool]:
        """Determine which legend sections to show based on available data"""
        milestone_col = self._get_milestone_column(df)
        milestone_status_col = self._get_milestone_status_column(df)
        plan_type_col = self._get_plan_type_column(df)
        expiry_col = self._get_expiry_column(df)
        
        return {
            'activity_types': 'Activity Type' in df.columns,
            'milestones': milestone_col is not None,
            'status_plan': milestone_status_col is not None or plan_type_col is not None,
            'expiry_warnings': expiry_col is not None
        }

    def _build_legend_header(self, legend_styles: Dict, terminology: Dict) -> str:
        """Build the legend header with controls"""
        return f"""
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
        """

    def _build_legend_content_start(self, legend_styles: Dict) -> str:
        """Build the opening of legend content container"""
        return f"""
            <!-- Legend Content -->
            <div id="legend-content" style="display: flex; gap: {legend_styles['gap']}px; padding: {legend_styles['padding']}px; {legend_styles['layout']} transition: all 0.3s ease-in-out;">
        """

    def _build_activity_types_section(self, df: pd.DataFrame, legend_styles: Dict, terminology: Dict) -> str:
        """Build activity types section"""
        if 'Activity Type' not in df.columns:
            return ""
        
        activity_types = sorted(df['Activity Type'].unique())
        icon = self.legend_config['icons']['activity']
        
        section_html = f"""
                <!-- Activity Types Column -->
                <div style="flex: 1; min-width: {legend_styles['column_min_width']}px;">
                    <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: {legend_styles['header_font_size']}px; display: flex; align-items: center;">
                        <span style="background: linear-gradient(45deg, #007bff, #0056b3); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">{icon}</span>
                        &nbsp;{terminology['activity_section']}
                    </h3>
                    <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add activity types
        for activity in activity_types:
            color = self.color_manager.get_activity_color(activity)
            section_html += f"""
                        <tr>
                            <td style="padding: 4px 8px; width: 20px;">
                                <div style="width: {legend_styles['icon_size']}px; height: {legend_styles['icon_height']}px; background-color: {color}; border: 1px solid #333; border-radius: 2px;"></div>
                            </td>
                            <td style="padding: 4px 8px; font-size: {legend_styles['text_font_size']}px; color: #495057;">{activity}</td>
                        </tr>
            """
        
        section_html += """
                    </table>
                </div>
        """
        
        return section_html

    def _build_milestones_section(self, df: pd.DataFrame, legend_styles: Dict, terminology: Dict) -> str:
        """Build milestones/checkpoints section with adaptive content"""
        milestone_col = self._get_milestone_column(df)
        if not milestone_col:
            return ""
        
        icon = self.legend_config['icons']['milestone']
        
        section_html = f"""
                <!-- Milestones Column -->
                <div style="flex: 1; min-width: {legend_styles['column_min_width']}px;">
                    <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: {legend_styles['header_font_size']}px; display: flex; align-items: center;">
                        <span style="background: linear-gradient(45deg, #28a745, #20c997); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">{icon}</span>
                        &nbsp;{terminology['milestone_section']}
                    </h3>
                    <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add milestone icons
        if hasattr(self.color_manager, 'readiness_check_icons'):
            milestone_icons = self.color_manager.readiness_check_icons
        else:
            # Create generic milestone icons from data
            unique_milestones = df[milestone_col].dropna().unique()
            milestone_icons = {}
            symbols = ['diamond', 'square', 'triangle-up', 'star', 'hexagon', 'circle', 'cross']
            for i, milestone in enumerate(sorted(unique_milestones)):
                milestone_icons[milestone] = {
                    'symbol': symbols[i % len(symbols)],
                    'position': i
                }
        
        for milestone_name, milestone_config in sorted(milestone_icons.items(), key=lambda x: x[1].get('position', 0)):
            symbol = self._get_unicode_symbol(milestone_config.get('symbol', 'circle'))
            section_html += f"""
                        <tr>
                            <td style="padding: 4px 8px; width: 20px; text-align: center; font-size: {legend_styles['symbol_font_size']}px; color: #333;">
                                {symbol}
                            </td>
                            <td style="padding: 4px 8px; font-size: {legend_styles['text_font_size']}px; color: #495057;"><strong>{milestone_name}</strong></td>
                        </tr>
            """
        
        section_html += """
                    </table>
                </div>
        """
        
        return section_html

    def _build_status_plan_section(self, df: pd.DataFrame, legend_styles: Dict, terminology: Dict) -> str:
        """Build status and plan types section"""
        milestone_status_col = self._get_milestone_status_column(df)
        plan_type_col = self._get_plan_type_column(df)
        
        if not milestone_status_col and not plan_type_col:
            return ""
        
        icon = self.legend_config['icons']['status']
        
        section_html = f"""
                <!-- Status & Plan Type Column -->
                <div style="flex: 1; min-width: {legend_styles['column_min_width']}px;">
                    <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: {legend_styles['header_font_size']}px; display: flex; align-items: center;">
                        <span style="background: linear-gradient(45deg, #6f42c1, #e83e8c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">{icon}</span>
                        &nbsp;{terminology['status_section']}
                    </h3>
        """
        
        # Add status colors if available
        if milestone_status_col:
            status_values = sorted(df[milestone_status_col].dropna().unique())
            if status_values:
                section_html += f"""
                    <!-- Status Colors -->
                    <h4 style="margin: 15px 0 8px 0; color: #6c757d; font-size: {legend_styles['subheader_font_size']}px; display: flex; align-items: center;">
                        <span style="margin-right: 6px;">🎨</span>Status Colors:
                    </h4>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
                """
                
                status_colors = self.color_manager.pattern_colors
                for status in status_values:
                    color = status_colors.get(status, '#cccccc')
                    section_html += f"""
                            <tr>
                                <td style="padding: 2px 8px; width: 20px;">
                                    <div style="width: {legend_styles['icon_size']}px; height: {legend_styles['status_icon_height']}px; background-color: {color}; border: 1px solid #333; border-radius: 1px;"></div>
                                </td>
                                <td style="padding: 2px 8px; font-size: {legend_styles['small_text_font_size']}px; color: #495057;">{status}</td>
                            </tr>
                    """
                
                section_html += """
                    </table>
                """
        
        # Add plan types if available
        if plan_type_col:
            plan_types = sorted(df[plan_type_col].dropna().unique())
            if plan_types:
                section_html += f"""
                    <!-- Plan Type Icons -->
                    <h4 style="margin: 15px 0 8px 0; color: #6c757d; font-size: {legend_styles['subheader_font_size']}px; display: flex; align-items: center;">
                        <span style="margin-right: 6px;">📋</span>{terminology['plan_section']}:
                    </h4>
                    <table style="width: 100%; border-collapse: collapse;">
                """
                
                plan_type_icons = getattr(self.color_manager, 'plan_type_icons', {})
                for plan_type in plan_types:
                    if plan_type in plan_type_icons:
                        config = plan_type_icons[plan_type]
                        color = config.get('color', '#333')
                        section_html += f"""
                                <tr>
                                    <td style="padding: 2px 8px; width: 20px;">
                                        <div style="width: {legend_styles['plan_icon_width']}px; height: {legend_styles['status_icon_height']}px; background-color: {color}; border: 1px solid #333; border-radius: 1px;"></div>
                                    </td>
                                    <td style="padding: 2px 8px; font-size: {legend_styles['small_text_font_size']}px; color: #495057;">{plan_type}</td>
                                </tr>
                        """
                
                section_html += """
                    </table>
                """
        
        section_html += """
                </div>
        """
        
        return section_html

    def _build_expiry_section(self, df: pd.DataFrame, legend_styles: Dict, terminology: Dict) -> str:
        """Build expiry/deadline warnings section"""
        expiry_col = self._get_expiry_column(df)
        if not expiry_col:
            return ""
        
        icon = self.legend_config['icons']['expiry']
        
        section_html = f"""
                <!-- Expiry/Deadline Column -->
                <div style="flex: 1; min-width: {legend_styles['column_min_width']}px;">
                    <h3 style="margin-top: 0; color: #495057; border-bottom: 2px solid #6c757d; padding-bottom: 8px; font-size: {legend_styles['header_font_size']}px; display: flex; align-items: center;">
                        <span style="background: linear-gradient(45deg, #dc3545, #fd7e14); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">{icon}</span>
                        &nbsp;{terminology['expiry_section']}
                    </h3>
                    <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Get the clock symbol
        clock_symbol = self._get_unicode_symbol('clock')
        section_html += f"""
                        <tr>
                            <td style="padding: 4px 8px; width: 20px; text-align: center; font-size: {legend_styles['symbol_font_size']}px; color: #dc3545;">
                                {clock_symbol}
                            </td>
                            <td style="padding: 4px 8px; font-size: {legend_styles['text_font_size']}px; color: #495057;"><strong>Important Dates</strong></td>
                        </tr>
                    </table>
                    
                    <h4 style="margin: 15px 0 8px 0; color: #6c757d; font-size: {legend_styles['subheader_font_size']}px; display: flex; align-items: center;">
                        <span style="margin-right: 6px;">🚨</span>Urgency Levels:
                    </h4>
                    <table style="width: 100%; border-collapse: collapse;">
        """
        
        # Add urgency levels
        if hasattr(self.color_manager, 'contract_expiration_icons'):
            urgency_colors = self.color_manager.contract_expiration_icons.get('urgency_colors', {})
        else:
            urgency_colors = {
                'expired': '#dc3545',
                'critical': '#fd7e14', 
                'warning': '#ffc107',
                'good': '#28a745'
            }
        
        urgency_labels = {
            'expired': 'Expired',
            'critical': '< 30 days',
            'warning': '30-90 days', 
            'good': '90+ days'
        }
        
        for urgency, color in urgency_colors.items():
            label = urgency_labels.get(urgency, urgency.title())
            section_html += f"""
                        <tr>
                            <td style="padding: 2px 8px; width: 20px; text-align: center;">
                                <div style="width: {legend_styles['urgency_icon_size']}px; height: {legend_styles['urgency_icon_size']}px; background-color: {color}; border: 1px solid #333; border-radius: 50%; margin: auto;"></div>
                            </td>
                            <td style="padding: 2px 8px; font-size: {legend_styles['small_text_font_size']}px; color: #495057;">{label}</td>
                        </tr>
            """
        
        section_html += """
                    </table>
                </div>
        """
        
        return section_html

    def _build_legend_footer(self) -> str:
        """Build the legend footer with JavaScript"""
        return """
            </div>
            
            <!-- Legend JavaScript for Interactive Features -->
            <script>
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
        </div>
        """

    def _calculate_responsive_styles(self, chart_width: int = None) -> Dict[str, int]:
        """Calculate responsive styling for legend based on chart width"""
        if chart_width is None:
            # Default values when chart width is not provided
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
                'layout': ''
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
                'layout': 'flex-wrap: wrap;'
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


# Backward compatibility class that wraps the original interface
class LegendGenerator(VersatileLegendGenerator):
    """Backward compatible wrapper for existing drilling functionality"""
    
    def __init__(self, color_manager: ColorManager):
        super().__init__(color_manager)
        
    def generate_legend_html(self, df: pd.DataFrame, chart_width: int = None) -> str:
        """Generate legend with automatic adaptation to data type"""
        return super().generate_legend_html(df, chart_width)
