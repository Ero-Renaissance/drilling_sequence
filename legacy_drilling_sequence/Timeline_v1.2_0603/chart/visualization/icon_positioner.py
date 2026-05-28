"""
Icon positioning module for drilling sequence charts.

This module handles the precise positioning and rendering of various icons and annotations
on Gantt charts, including readiness check icons, plan type indicators, contract expiration
warnings, and project name annotations.
"""

from datetime import datetime, timedelta
from typing import List, Dict
import pandas as pd
import plotly.graph_objects as go
from ..core.color_manager import ColorManager


class IconPositioner:
    """Handles readiness check icon positioning with proper coordinate calculation"""
    
    def __init__(self, color_manager: ColorManager):
        self.color_manager = color_manager
        
        # Positioning constants
        self.ICON_VERTICAL_OFFSET = 0.1  # Distance below bar center (positive to go below)
        self.ICON_SIZE = 14
        self.MIN_ICON_SPACING_DAYS = 2.0  # Minimum horizontal spacing
    def add_readiness_check_icons(self, fig: go.Figure, df: pd.DataFrame, 
                                 y_category_array: List[str]) -> None:
        """Add readiness check icons below activity bars with proper positioning"""
        
        if not hasattr(self.color_manager, 'readiness_check_icons'):
            self.color_manager._set_default_readiness_checks()
        
        # Convert y-categories to list for indexing
        y_categories_list = list(y_category_array)
        
        # Create dynamic grouping fields based on available columns
        unique_bar_fields = ['Composite Label', 'Activity Type', 'Start Date', 'End Date']
        
        # Add item/well identifier column if available
        for col in ['Well Name', 'Item Name', 'Task Name', 'Project Name', 'Name']:
            if col in df.columns:
                unique_bar_fields.insert(1, col)  # Insert after Composite Label
                break
        
        grouped_bars = df.groupby(unique_bar_fields, observed=True, sort=False)
        
        for bar_identity_tuple, bar_segment_data in grouped_bars:
            self._process_bar_segment(fig, bar_identity_tuple, bar_segment_data, y_categories_list) 

    def _process_bar_segment(self, fig: go.Figure, bar_identity_tuple: tuple, 
                           bar_segment_data: pd.DataFrame, y_categories_list: List[str]) -> None:
        """Process a single bar segment for icon placement"""
        
        y_position_label = bar_identity_tuple[0]
        start_date = bar_identity_tuple[3]
        end_date = bar_identity_tuple[4]
        
        # Validate y-position exists in chart
        try:
            y_index = y_categories_list.index(y_position_label)
        except ValueError:
            print(f"Warning: Label '{y_position_label}' not found in chart. Skipping icons.")
            return
        
        bar_duration_days = max(1, (end_date - start_date).days)
        
        # Process readiness check icons
        checks_data = bar_segment_data[['Readiness Check', 'Readiness Check Status']].drop_duplicates()
        checks_data = checks_data.dropna(subset=['Readiness Check'])
        if not checks_data.empty:
            readiness_icon_positions = self._calculate_readiness_icon_positions(checks_data, start_date, bar_duration_days)
            if readiness_icon_positions:
                self._add_readiness_icons_to_chart(fig, readiness_icon_positions, y_position_label, y_index)
        
        # Process project name annotations
        project_data = bar_segment_data[['Project']].drop_duplicates()
        project_data = project_data.dropna(subset=['Project'])
        if not project_data.empty:
            self._add_project_annotations(fig, project_data, y_position_label, y_index, start_date, end_date)
          
        # Process plan type icons using annotations
        plan_type_data = bar_segment_data[['Plan Type']].drop_duplicates()
        plan_type_data = plan_type_data.dropna(subset=['Plan Type'])
        if not plan_type_data.empty:
            self._add_plan_type_annotations(fig, plan_type_data, y_position_label, y_index, start_date)

        # Process contract expiration icons
        contract_data = bar_segment_data[['Rig Contract Expiry Date']].drop_duplicates()
        contract_data = contract_data.dropna(subset=['Rig Contract Expiry Date'])
        
        if not contract_data.empty:
            self._add_contract_expiration_annotations(fig, contract_data, y_position_label, y_index)    

    def _calculate_readiness_icon_positions(self, checks_data: pd.DataFrame, start_date: datetime, 
                                bar_duration_days: int) -> List[Dict]:
        """Calculate optimal positions for icons using 50% bar width with uniform spacing"""
        
        # Sort checks by configured position
        checks_data = checks_data.copy()
        checks_data['config_pos'] = checks_data['Readiness Check'].map(
            lambda x: self.color_manager.readiness_check_icons.get(x, {}).get('position', 999)
        )
        checks_data = checks_data.sort_values('config_pos')
        
        num_icons = len(checks_data)
        
        # New algorithm: Icons occupy 50% of bar width with uniform spacing
        ICON_ZONE_PERCENTAGE = 0.5  # Icons occupy 50% of the bar width
        STANDARD_READINESS_COUNT = 7  # Standard number of readiness checks
        
        # Calculate the zone width where icons will be placed (50% of bar)
        icon_zone_width_days = bar_duration_days * ICON_ZONE_PERCENTAGE
        
        # Calculate uniform spacing within the icon zone
        if num_icons > 1:
            # For multiple icons, distribute them evenly within the icon zone
            spacing = icon_zone_width_days / (num_icons - 1)  # Space between icons
        else:
            # For single icon, place it at the center of the icon zone
            spacing = 0
        
        # Calculate starting position to center the icon zone within the bar
        # Icon zone starts at 25% of bar width (to center the 50% zone)
        icon_zone_start_offset = bar_duration_days * 0.25
        
        # Generate positions with uniform spacing
        icon_positions = []
        for idx, (_, row) in enumerate(checks_data.iterrows()):
            if num_icons == 1:
                # Single icon: place at center of icon zone
                x_offset_days = icon_zone_start_offset + (icon_zone_width_days / 2)
            else:
                # Multiple icons: distribute evenly within icon zone
                x_offset_days = icon_zone_start_offset + (idx * spacing)
            
            x_position = start_date + timedelta(days=x_offset_days)
            
            # Get icon configuration
            icon_config = self.color_manager.readiness_check_icons.get(
                row['Readiness Check'], {'symbol': 'circle'}
            )
            icon_positions.append({
                'x': x_position,
                'symbol': icon_config.get('symbol', 'circle'),
                'color': self.color_manager.get_pattern_color(row['Readiness Check Status']),
                'label': row['Readiness Check'],
                'status': row['Readiness Check Status']  # Add status for hover text
            })
        
        return icon_positions
      
    def _create_multi_row_icon_positions(self, checks_data: pd.DataFrame, start_date: datetime, 
                                       bar_duration_days: int) -> List[Dict]:
        """Create multi-row layout for crowded icon scenarios"""
        
        num_icons = len(checks_data)
        
        # Configuration for multi-row layout
        MAX_ICONS_PER_ROW = 4 if num_icons <= 8 else 3  # Fewer icons per row if many total
        ROW_VERTICAL_SPACING = 0.15  # Smaller distance between rows
        
        # Split icons into rows
        rows = []
        for i in range(0, num_icons, MAX_ICONS_PER_ROW):
            row_icons = checks_data.iloc[i:i+MAX_ICONS_PER_ROW]
            rows.append(row_icons)
        
        icon_positions = []
        
        for row_idx, row_icons in enumerate(rows):
            num_icons_in_row = len(row_icons)
            
            # Calculate spacing for this row
            spacing = bar_duration_days / num_icons_in_row
            margin = 0  # No margin needed - distribute across full width
            
            # Calculate vertical offset for this row
            # First row at normal position, subsequent rows below with positive increments
            vertical_offset = self.ICON_VERTICAL_OFFSET + (row_idx * ROW_VERTICAL_SPACING)
            
            for icon_idx, (_, row) in enumerate(row_icons.iterrows()):
                # Calculate x position for this icon in the row
                x_offset_days = margin + (icon_idx + 0.5) * spacing
                x_position = start_date + timedelta(days=x_offset_days)
                
                # Get icon configuration
                icon_config = self.color_manager.readiness_check_icons.get(
                    row['Readiness Check'], {'symbol': 'circle'}
                )
                icon_positions.append({
                    'x': x_position,
                    'symbol': icon_config.get('symbol', 'circle'),
                    'color': self.color_manager.get_pattern_color(row['Readiness Check Status']),
                    'label': row['Readiness Check'],
                    'status': row['Readiness Check Status'],  # Add status for hover text
                    'vertical_offset': vertical_offset  # Additional offset for multi-row
                })
        
        return icon_positions

    def _add_plan_type_annotations(self, fig: go.Figure, plan_type_data: pd.DataFrame, 
                                 y_position_label: str, y_index: int, start_date: datetime) -> None:
        """Add plan type icons as annotations positioned at the top of bars"""
        
        if plan_type_data.empty:
            return
        
        # Get plan type configuration
        if not hasattr(self.color_manager, 'plan_type_icons'):
            self.color_manager._set_default_readiness_checks()
        
        for _, row in plan_type_data.iterrows():
            plan_type = row['Plan Type']
            plan_config = self.color_manager.plan_type_icons.get(plan_type, {})
            symbol = plan_config.get('symbol', 'square')
            color = plan_config.get('color', '#cccccc')
            
            # Convert symbol to Unicode
            symbol_unicode = self._get_icon_symbol(symbol)
            
            # Position annotation at the top of the bar
            # With reversed y-axis, subtract from y_index to position above
            annotation_y = y_index - 0.3  # Above bar center              
            
            # Add the annotation at the start of the bar
            fig.add_annotation(
                x=start_date + pd.Timedelta(days=2), # Position slightly right of start date
                y=annotation_y,
                text=f"<b style='font-family: Arial Unicode MS, Arial, sans-serif;'>{symbol_unicode}</b>",
                showarrow=False,
                font=dict(
                    size=20,
                    color=color,
                    family="Arial Unicode MS, Arial, sans-serif"
                ),
                xref='x',
                yref='y',
                bgcolor="rgba(255,255,255,0.9)",
                bordercolor=color,
                borderwidth=2,
                borderpad=4,
                hovertext=f"Plan Type: {plan_type}"
            )
              
    def _add_readiness_icons_to_chart(self, fig: go.Figure, icon_positions: List[Dict], 
                          y_position_label: str, y_index: int) -> None:
        """Add readiness check icons as annotations positioned at the bottom of bars"""
        
        if not icon_positions:
            return
        
        # Use annotations for precise positioning - much more reliable than scatter traces
        for pos in icon_positions:
            # Calculate y position for this icon
            vertical_offset = pos.get('vertical_offset', self.ICON_VERTICAL_OFFSET)
            annotation_y = y_index + vertical_offset  # Below bar center
            
            # Get icon symbol
            symbol_unicode = self._get_icon_symbol(pos['symbol'])           
             
            # Add annotation for this readiness check icon with gray symbol and colored border
            fig.add_annotation(
                x=pos['x'],
                y=annotation_y,
                text=f"<b style='font-family: Arial Unicode MS, Arial, sans-serif;'>{symbol_unicode}</b>",
                showarrow=False,
                font=dict(
                    size=20,  # Slightly larger for better visibility
                    color="#666666",  # Gray color for the symbol itself
                    family="Arial Unicode MS, Arial, sans-serif"  # Better font fallback
                ),
                xref='x',
                yref='y',
                bgcolor="rgba(255,255,255,0.95)",  # White background
                bordercolor=pos['color'],  # Status color for border
                borderwidth=3,  # Slightly thicker border to make status more visible
                borderpad=5,  # Add padding for better appearance
                hovertext=f"Readiness Check: {pos['label']} - Status: {pos.get('status', 'Unknown')}"
            )

    def _add_contract_expiration_annotations(self, fig: go.Figure, contract_data: pd.DataFrame, 
                                           y_position_label: str, y_index: int) -> None:
        """Add contract expiration icons positioned at the right side of bars"""
        
        if contract_data.empty:
            return
        
        # Get contract expiration configuration
        if not hasattr(self.color_manager, 'contract_expiration_icons'):
            self.color_manager._set_default_readiness_checks()
        
        for _, row in contract_data.iterrows():
            expiry_date = pd.to_datetime(row['Rig Contract Expiry Date'])
            
            # Calculate urgency level and color
            today = datetime.now()
            days_until_expiry = (expiry_date - today).days
            
            # Determine urgency color
            if days_until_expiry < 0:
                urgency_level = 'expired'
            elif days_until_expiry <= 30:
                urgency_level = 'critical'
            elif days_until_expiry <= 90:
                urgency_level = 'warning'
            else:
                urgency_level = 'good'
            
            config = self.color_manager.contract_expiration_icons
            color = config['urgency_colors'][urgency_level]
            symbol_unicode = self._get_icon_symbol(config['symbol'])
            
            # Debug print
            print(f"Adding contract expiration icon: {symbol_unicode} at {expiry_date} with color {color}")
            
            # Position annotation at the right side of the bar (at expiry date)
            # With reversed y-axis, position at bar center level
            annotation_y = y_index - 0.1 # At bar center level
              
            # Add the annotation at the contract expiry date
            fig.add_annotation(
                x=expiry_date,
                y=annotation_y,
                text=f"<b style='font-family: Arial Unicode MS, Arial, sans-serif; font-size: 22px;'>{symbol_unicode}</b>",
                showarrow=False,
                font=dict(
                    size=config['size'],
                    color=color,
                    family="Arial Unicode MS, Arial, sans-serif"
                ),
                xref='x',
                yref='y',
                bgcolor="rgba(255,255,255,0.95)",
                bordercolor=color,
                borderwidth=2,
                borderpad=4,
                hovertext=f"Contract Expires: {expiry_date.strftime('%Y-%m-%d')}<br>Days Remaining: {days_until_expiry}"
            )

    def _get_icon_symbol(self, symbol_name: str) -> str:
        """Convert plotly symbol names to HTML entities for better browser compatibility"""
        # Using HTML entities ensures better cross-browser compatibility
        symbol_map = {
            'circle': '&#9679;',           # ● - BUD - Budget (solid, complete)
            'square': '&#9632;',           # ■ - LLI - Land/Legal Issues (solid, stable)
            'diamond': '&#9830;',          # ♦ - FID - Final Investment Decision (valuable)
            'triangle-up': '&#9650;',      # ▲ - LOC - Location (pointing, directional)
            'triangle-down': '&#9660;',    # ▼ - Alternative triangle
            'star': '&#9733;',             # ★ - EIA - Environmental (important, standout)
            'cross': '&#10005;',           # ✕ - SUBS - Subsurface (technical, intersection)
            'x': '&#10007;',               # ✗ - Alternative cross
            'pentagon': '&#11039;',        # ⬟ - Complex geometric shape
            'hexagon': '&#11042;',         # ⬢ - FLOOD - Environmental (natural pattern)
            'clock': '&#9200;'             # ⏰ - Contract expiration - Better alarm clock
        }       
        
        return symbol_map.get(symbol_name, '&#9679;')    

    def _add_project_annotations(self, fig: go.Figure, project_data: pd.DataFrame, 
                               y_position_label: str, y_index: int, start_date: datetime, end_date: datetime) -> None:
        """Add project name annotations positioned above the Gantt chart bars with enhanced typography"""
        
        if project_data.empty:
            return
        
        for _, row in project_data.iterrows():
            project_name = row['Project']
            
            # Calculate the center position of the bar for text placement
            bar_center_date = start_date + (end_date - start_date) / 2
            
            # Position annotation above the plan type icons
            # Plan types are at y_index - 0.3, so position project names at y_index - 0.4
            annotation_y = y_index - 0.4
            
            # Enhanced styling with modern typography and visual effects
            fig.add_annotation(
                x=bar_center_date,
                y=annotation_y,
                text=f"<span style='font-family: \"Roboto\", \"Segoe UI\", Arial, sans-serif; font-weight: 700; letter-spacing: 0.4px; text-shadow: 0 2px 4px rgba(0,0,0,0.1); color: #1a202c;'>{project_name}</span>",
                showarrow=False,
                font=dict(
                    size=17,  # Increased from 16px for better visibility
                    color="#1a202c",  # Rich dark color for excellent contrast
                    family="Roboto, Segoe UI, Arial, sans-serif"
                ),
                xref='x',
                yref='y',
                # Enhanced background with modern gradient-like effect
                bgcolor="rgba(255, 255, 255, 0.97)",  # Higher opacity for better background
                bordercolor="rgba(160, 174, 192, 0.6)",  # Softer, more elegant border
                borderwidth=1.2,  # Slightly thicker for better definition
                borderpad=8,  # Increased padding for more spacious feel
                # Add rounded corner effect and subtle styling
                hovertext=f"Project: {project_name}",
                captureevents=True,
                # Additional styling for modern appearance
                align="center",
                valign="middle"
            )
