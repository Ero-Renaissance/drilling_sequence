"""
Legend generation module for timeline charts with drilling compatibility.

This module provides the LegendGenerator class that creates comprehensive HTML legends
with adaptive content based on available data, while maintaining backward compatibility
with drilling-specific functionality.
"""

import pandas as pd
from typing import Dict, Optional
from ..core.color_manager import ColorManager
from .versatile_legend_generator import VersatileLegendGenerator


class LegendGenerator:
    """Generates adaptive HTML legends that work with any timeline data"""
    def __init__(self, color_manager: ColorManager, legend_config: Optional[Dict] = None):
        self.color_manager = color_manager
        self.versatile_generator = VersatileLegendGenerator(color_manager, legend_config)

    def generate_legend_html(self, df: pd.DataFrame, chart_width: int = None) -> str:
        """Generate adaptive HTML legend based on available data and data type"""
        return self.versatile_generator.generate_legend_html(df, chart_width)

    def _calculate_responsive_styles(self, chart_width: int = None) -> Dict[str, int]:
        """Calculate responsive styling for legend based on chart width"""
        return self.versatile_generator._calculate_responsive_styles(chart_width)

    def _get_unicode_symbol(self, symbol_name: str) -> str:
        """Convert symbol names to HTML entities for better browser compatibility"""
        return self.versatile_generator._get_unicode_symbol(symbol_name)
