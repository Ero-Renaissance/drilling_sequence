"""
Color management system for chart visualization.

This module provides dynamic color management for drilling sequence charts,
including activity colors, status patterns, and icon configurations.
"""

import os
import json
import random
import colorsys
from collections import defaultdict
from typing import Dict, List


class ColorManager:
    """Dynamic color management system for chart visualization"""
    
    def __init__(self, config_file: str = "chart_colors.json"):
        self.config_file = config_file
        self.activity_colors: Dict[str, str] = {}
        self.pattern_colors: Dict[str, str] = {}
        self.pattern_shapes: Dict[str, str] = {}
        self.readiness_check_icons: Dict[str, Dict] = {}
        self.color_families: Dict[str, List[str]] = defaultdict(list)
        self.activity_patterns: Dict[str, str] = {}
        self._load_config()
        
    def _load_config(self) -> None:
        """Load color configurations from file or create defaults"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:                    
                    config = json.load(f)
                    self.activity_colors = config.get('activity_colors', {})
                    self.pattern_colors = config.get('pattern_colors', {})
                    self.pattern_shapes = config.get('pattern_shapes', {})
                    self.readiness_check_icons = config.get('readiness_check_icons', {})
                    self.plan_type_icons = config.get('plan_type_icons', {})
                    self.contract_expiration_icons = config.get('contract_expiration_icons', {})
                    
                    # Sanitize colors to ensure proper hex format
                    self._sanitize_colors()
                    
                    if not self.readiness_check_icons:
                        self._set_default_readiness_checks()
            except Exception as e:
                print(f"Error loading color config: {e}. Using defaults.")
                self._create_default_colors()
        else:
            print(f"Config file {self.config_file} not found. Using defaults.")
            self._create_default_colors()
            
        self._build_color_families()
    
    def _sanitize_colors(self) -> None:
        """Ensure colors are in proper hex format (#RRGGBB)"""
        for color_dict in [self.activity_colors, self.pattern_colors]:
            for key, color_val in list(color_dict.items()):
                if isinstance(color_val, str) and color_val.startswith('#') and len(color_val) == 9:
                    color_dict[key] = color_val[:7]  # Convert #RRGGBBAA to #RRGGBB
                    
    def _set_default_readiness_checks(self) -> None:
        """Set default readiness check icons with unique symbols for each check type"""
        self.readiness_check_icons = {
            "BUD": {"position": 0, "symbol": "diamond"},        # Budget - Diamond (valuable/financial)
            "LLI": {"position": 1, "symbol": "square"},         # Land/Legal Issues - Square (solid/legal)
            "LOC": {"position": 2, "symbol": "triangle-up"},    # Location - Triangle (pointing/directional)
            "FID": {"position": 3, "symbol": "star"},           # Final Investment Decision - Star (important)
            "EIA": {"position": 4, "symbol": "hexagon"},        # Environmental Impact Assessment - Hexagon (complex)
            "FLOOD": {"position": 5, "symbol": "circle"},       # Flood - Circle (natural/flow)
            "SUBS": {"position": 6, "symbol": "cross"}          # Subsurface - Cross (technical/engineering)
        }
        
        # Plan Type icon configurations
        self.plan_type_icons = {
            'In Plan(Firm)': {'symbol': 'square', 'color': '#4d4d4d'},  # Dark grey
            'In Plan(Option)': {'symbol': 'square', 'color': '#28a745'},  # Green
            'Out of Plan': {'symbol': 'square', 'color': '#dc3545'}  # Red
        }
        
        # Contract expiration icon configurations
        self.contract_expiration_icons = {
            'symbol': 'clock',  # Clock symbol for contract expiration
            'size': 20,  # Slightly larger than other icons
            'urgency_colors': {
                'expired': '#dc3545',    # Red - already expired
                'critical': '#fd7e14',   # Orange - expires within 30 days
                'warning': '#ffc107',    # Yellow - expires within 90 days
                'good': '#28a745'        # Green - expires in 90+ days
            }
        }
        
    def _create_default_colors(self) -> None:
        """Create default color schemes"""
        # Default pattern colors for status clarity
        self.pattern_colors = {
            'Completed': '#00ff00',
            'Plan on track': '#ffff00',
            'Behind Schedule': '#ff0000'
        }
        
        # Default pattern shapes for similar activities
        self.pattern_shapes = {
            'Appraisal': '|',
            'Workover': '/',
            'Sidetrack': '\\'
        }

        # Predefined activity colors for consistency
        self.activity_colors = {
            'Oil Development': '#d62728',
            'Gas Development': '#23a94d',
            'Oil Exploration': '#ff9900',
            'Gas Exploration': '#c4c400',
            'Well Repair/Safety': '#1f77b4',
            'HPHT(Development)': '#9467bd',
            'Rig Idle': "#2c2c2a",
            'Contracting': "#e7ebca"
        }

        self._set_default_readiness_checks()
    
    def _build_color_families(self) -> None:
        """Group activities by keyword to ensure color consistency"""
        self.color_families = defaultdict(list)
        self.activity_patterns = {}
        
        for activity in self.activity_colors:
            # Check for pattern keywords
            for pattern_key, pattern in self.pattern_shapes.items():
                if pattern_key in activity:
                    self.activity_patterns[activity] = pattern
                    break
            
            # Group by common prefixes
            for prefix in ['Oil', 'Gas', 'Water', 'HPHT']:
                if activity.startswith(prefix):
                    self.color_families[prefix].append(activity)
                    break
    
    def _generate_color_in_family(self, family_key: str) -> str:
        """Generate a color similar to others in the same family"""
        family = self.color_families.get(family_key, [])
        
        if not family:
            # Generate base color for new family
            hue = random.random()
            saturation = 0.7 + random.random() * 0.3
            value = 0.5 + random.random() * 0.3
            r, g, b = colorsys.hsv_to_rgb(hue, saturation, value)
            return f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}'
        
        # Create variation of existing family color
        base_color = self.activity_colors[family[0]]
        r = int(base_color[1:3], 16)
        g = int(base_color[3:5], 16)
        b = int(base_color[5:7], 16)
        
        # Convert to HSV for better color variation
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        
        # Vary the hue slightly within the family
        h = (h + random.uniform(-0.05, 0.05)) % 1.0
        s = max(0.6, min(0.9, s + random.uniform(-0.1, 0.1)))
        v = max(0.5, min(0.9, v + random.uniform(-0.1, 0.1)))
        
        r, g, b = colorsys.hsv_to_rgb(h, s, v)
        return f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}'
    
    def _generate_random_color(self) -> str:
        """Generate a random visually distinct color"""
        existing_colors = list(self.activity_colors.values())
        
        max_attempts = 50
        for _ in range(max_attempts):
            hue = random.random()
            saturation = 0.7 + random.random() * 0.3
            value = 0.6 + random.random() * 0.3
            r, g, b = colorsys.hsv_to_rgb(hue, saturation, value)
            new_color = f'#{int(r*255):02x}{int(g*255):02x}{int(b*255):02x}'
            
            if self._is_distinct_enough(new_color, existing_colors):
                return new_color
        
        # Fallback if no distinct color found
        return f'#{random.randint(0, 255):02x}{random.randint(0, 255):02x}{random.randint(0, 255):02x}'
    
    def _is_distinct_enough(self, color: str, existing_colors: List[str], threshold: int = 30) -> bool:
        """Check if a color is visually distinct from existing colors"""
        r1 = int(color[1:3], 16)
        g1 = int(color[3:5], 16)
        b1 = int(color[5:7], 16)
        
        for existing in existing_colors:
            r2 = int(existing[1:3], 16)
            g2 = int(existing[3:5], 16)
            b2 = int(existing[5:7], 16)
            
            distance = ((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2)**0.5
            if distance < threshold:
                return False
                
        return True
    
    def get_activity_color(self, activity: str) -> str:
        """Get color for activity, generating one if needed"""
        if activity not in self.activity_colors:
            # Determine family
            family_key = None
            for prefix in ['Oil', 'Gas', 'Water', 'HPHT', 'Rig']:
                if activity.startswith(prefix):
                    family_key = prefix
                    break
            
            # Generate color
            if family_key:
                self.activity_colors[activity] = self._generate_color_in_family(family_key)
                self.color_families[family_key].append(activity)
            else:
                self.activity_colors[activity] = self._generate_random_color()
            
            self.save_config()
            
        return self.activity_colors[activity]
    
    def get_pattern_color(self, status: str) -> str:
        """Get color for status pattern"""
        return self.pattern_colors.get(status, "#cccccc")
        
    def get_pattern_shape(self, status: str) -> str:
        """Get pattern shape for status"""
        return self.pattern_shapes.get(status, "")
    
    def get_plan_type_color(self, plan_type: str) -> str:
        """Get color for plan type"""
        if not hasattr(self, 'plan_type_icons'):
            self._set_default_readiness_checks()
        return self.plan_type_icons.get(plan_type, {}).get('color', '#cccccc')
        
    def save_config(self) -> None:
        """Save current color configuration to file"""
        config = {
            'activity_colors': self.activity_colors,
            'pattern_colors': self.pattern_colors,
            'pattern_shapes': self.pattern_shapes,
            'readiness_check_icons': self.readiness_check_icons,
            'plan_type_icons': getattr(self, 'plan_type_icons', {}),
            'contract_expiration_icons': getattr(self, 'contract_expiration_icons', {})
        }
        
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
        except Exception as e:
            print(f"Error saving color configuration: {e}")
