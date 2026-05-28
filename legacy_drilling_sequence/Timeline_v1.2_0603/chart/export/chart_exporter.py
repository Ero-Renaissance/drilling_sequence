"""
Chart export module for drilling sequence Gantt charts.

This module provides the ChartExporter class that handles exporting charts as HTML
with custom legends and KPI dashboards.
"""

import os
import pandas as pd
import plotly.graph_objects as go
from typing import Optional

from ..core.color_manager import ColorManager
from ..core.chart_generator import ChartGenerator
from ..visualization.legend_generator import LegendGenerator
from ..visualization.signature_generator import SignatureGenerator


class ChartExporter:
    """Handles chart export functionality"""
    
    @staticmethod
    def export_chart(fig: go.Figure, output_dir: str, df: pd.DataFrame, color_manager: ColorManager, customization: dict = None) -> None:
        """Export chart as HTML with custom legend and sticky KPI dashboard"""
        print(f"Exporting chart to {output_dir}...")
        
        # Extract title configuration from customization
        dashboard_title = None
        dashboard_subtitle = None
        document_title = None
        
        if customization:
            dashboard_title = customization.get('dashboard_title')
            dashboard_subtitle = customization.get('dashboard_subtitle')  
            document_title = customization.get('html_document_title')
        
        # Auto-generate titles if not provided
        if not dashboard_title:
            dashboard_title = ChartExporter._generate_auto_dashboard_title(df)
            
        if not dashboard_subtitle:
            dashboard_subtitle = ChartExporter._generate_auto_subtitle(df)
            
        if not document_title:
            document_title = dashboard_title
        
        # Generate legend HTML with responsive styling
        legend_generator = LegendGenerator(color_manager)
        chart_width = fig.layout.width if fig.layout.width else None
        legend_html = legend_generator.generate_legend_html(df, chart_width)
          # Generate signature section HTML
        signature_generator = SignatureGenerator()
        # Extract signature parameters from customization
        signature_document_title = customization.get('document_title', 'Timeline Chart') if customization else 'Timeline Chart'
        document_revision = customization.get('document_revision', 'Rev. 01') if customization else 'Rev. 01'
        signatory_roles = customization.get('signatory_roles') if customization else None
        
        signature_html = signature_generator.generate_signature_html(
            document_title=signature_document_title,
            revision=document_revision,
            chart_width=chart_width,
            custom_roles=signatory_roles
        )
        
        # Generate sticky KPI HTML
        chart_generator = ChartGenerator(color_manager)
        sticky_kpi_html = chart_generator.generate_sticky_kpi_html(df)
        
        # Export HTML with embedded legend, signature section and sticky KPI dashboard
        ChartExporter._export_html_with_legend(
            fig, output_dir, legend_html, sticky_kpi_html, signature_html, 
            signature_generator, dashboard_title, dashboard_subtitle, document_title
        )
        
        print(f"Chart exported successfully to: {os.path.abspath(output_dir)}")
        print(f"- HTML file: drilling_sequence.html (with interactive dashboard)")
        print("Note: For PDF export, open the HTML file in your browser and use 'Print to PDF'")

    @staticmethod
    def _generate_auto_dashboard_title(df: pd.DataFrame) -> str:
        """Generate an appropriate dashboard title based on available data columns"""
        # Check what types of data we have to determine the best title
        has_drilling_data = all(col in df.columns for col in ['Well Name', 'Rig Name'])
        has_readiness_data = 'Readiness Check Status' in df.columns and df['Readiness Check Status'].notna().any()
        has_project_data = 'Project' in df.columns and df['Project'].nunique() > 1
        
        # Generate title based on data characteristics
        if has_drilling_data and has_readiness_data:
            return "🛢️ Drilling Operations Schedule & Readiness Dashboard"
        elif has_drilling_data:
            return "🛢️ Drilling Operations Schedule Dashboard"
        elif has_project_data:
            return "📊 Project Timeline & Schedule Dashboard"
        elif 'Well Name' in df.columns:
            return "🔹 Wells Timeline & Schedule Dashboard"
        else:
            return "📈 Timeline & Schedule Dashboard"

    @staticmethod
    def _generate_auto_subtitle(df: pd.DataFrame) -> str:
        """Generate an appropriate subtitle based on available data"""
        subtitle_parts = []
        
        # Add descriptive elements based on available columns
        if 'Readiness Check Status' in df.columns and df['Readiness Check Status'].notna().any():
            subtitle_parts.append("readiness status")
            
        if 'Rig Contract Expiry Date' in df.columns and df['Rig Contract Expiry Date'].notna().any():
            subtitle_parts.append("contract management")
            
        if 'Risk' in df.columns and df['Risk'].notna().any():
            subtitle_parts.append("risk tracking")
            
        if 'Project' in df.columns and df['Project'].nunique() > 1:
            subtitle_parts.append("project coordination")
              # Create comprehensive subtitle
        if subtitle_parts:
            if len(subtitle_parts) == 1:
                return f"Comprehensive view of timeline activities and {subtitle_parts[0]}"
            elif len(subtitle_parts) == 2:
                return f"Comprehensive view of timeline activities, {subtitle_parts[0]} and {subtitle_parts[1]}"
            else:
                return f"Comprehensive view of timeline activities, {', '.join(subtitle_parts[:-1])} and {subtitle_parts[-1]}"
        else:
            return "Comprehensive view of timeline activities and schedule management"
    
    @staticmethod
    def _export_html_with_legend(fig: go.Figure, output_dir: str, legend_html: str, sticky_kpi_html: str = "", 
                                signature_html: str = "", signature_generator: SignatureGenerator = None,
                                dashboard_title: str = None, dashboard_subtitle: str = None, 
                                document_title: str = None) -> None:
        """Export HTML file with embedded custom legend, signature section, sticky KPI dashboard, and configurable titles"""
        # Generate plotly HTML
        html_content = fig.to_html(include_plotlyjs=True, div_id="chart")
        
        # Use provided titles or defaults
        doc_title = document_title or "Timeline Dashboard"
        header_title = dashboard_title or "📈 Timeline & Schedule Dashboard"
        header_subtitle = dashboard_subtitle or "Comprehensive view of timeline activities and schedule management"
        
        # Get signature CSS and JS from generator
        signature_css = signature_generator.get_signature_css() if signature_generator else ""
        signature_js = signature_generator.get_signature_javascript() if signature_generator else ""
          # Create comprehensive HTML with improved layout for better scrolling UX
        full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{doc_title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{
            box-sizing: border-box;
        }}
        
        body {{
            margin: 0;
            font-family: 'Roboto', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            overflow: hidden;
            color: #333;
        }}                    
        
        .main-container {{
            display: flex;
            flex-direction: column;
            height: 100vh;
            max-width: none;
            margin: 0;
            padding: 0;
            background: white;
            box-shadow: 0 0 30px rgba(0,0,0,0.1);
        }}
          
        /* Header section styles */
        .header-section {{
            flex-shrink: 0;
            background: linear-gradient(135deg, #1f4e79 0%, #2a5a8a 100%);
            color: white;
            padding: 20px 30px;
            text-align: center;
            border-bottom: 2px solid #3498db;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        
        .header-title {{
            margin: 0;
            font-size: 24px;
            font-weight: 600;
            text-align: center;
            text-shadow: 0 1px 3px rgba(0,0,0,0.3);
            letter-spacing: 0.5px;
        }}
        
        .header-subtitle {{
            margin: 5px 0 0 0;
            font-size: 14px;
            text-align: center;
            opacity: 0.9;
            font-weight: 300;
        }}
          
        .content-wrapper {{
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0; 
            background: #f8f9fa;
            position: relative;
            overflow-y: auto; /* ADDED: Allow vertical scrolling for the content area */
        }}
        
        .chart-scroll-container {{
            flex: 1; 
            overflow: auto; 
            padding: 25px;
            min-height: 70vh; /* CHANGED: Set a minimum height (50% of viewport height) */
            background: white;
            margin: 0 15px 15px 15px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            border: 1px solid #e9ecef;
            position: relative;
        }}
        
        .chart-scroll-container::before {{
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, #667eea, #764ba2, #667eea);
            border-radius: 14px;
            z-index: -1;
            opacity: 0.1;
        }}
               
        .chart-container {{
            min-width: 1200px; /* Retained for Gantt chart legibility */
            width: 100%; /* Allow expansion */
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 15px rgba(0,0,0,0.08);
            overflow: hidden; /* Keeps content like Plotly chart contained */
        }}
        
        /* Ensure the Plotly chart div takes full width of its container */
        #chart,
        #chart .plotly, /* Target Plotly's main container */
        #chart .main-svg {{ /* Target the main SVG element within Plotly chart */
            width: 100% !important;
            height: 100% !important; /* Ensure height also adjusts if necessary */
        }}

        .legend-container {{
            flex-shrink: 0;
            margin: 0 10px 10px 10px;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 15px rgba(0,0,0,0.08);
            border: 1px solid #e9ecef;
            padding: 5px; /* Added padding */
        }}
        
        .signature-container {{
            flex-shrink: 0;
            margin: 0 10px 10px 10px;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 15px rgba(0,0,0,0.08);
            border: 1px solid #e9ecef;
            overflow: hidden;
            padding: 5px; /* Added padding */
        }}
        
        /* Enhanced project annotation styling */
        .plotly-annotation {{
            filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            transition: all 0.2s ease-in-out;
        }}
        
        .plotly-annotation:hover {{
            filter: drop-shadow(0 4px 8px rgba(0,0,0,0.15));
            transform: translateY(-1px);
        }}
        
        /* Improved typography for annotations */
        .annotation-text {{
            font-family: 'Roboto', 'Segoe UI', Arial, sans-serif;
            font-weight: 600;
            letter-spacing: 0.3px;
            text-rendering: optimizeLegibility;
        }}
          /* Scroll enhancements */
        ::-webkit-scrollbar {{
            width: 12px;
            height: 12px;
        }}
        
        ::-webkit-scrollbar-track {{
            background: #f1f3f4;
            border-radius: 6px;
        }}
        
        ::-webkit-scrollbar-thumb {{
            background: linear-gradient(45deg, #1f4e79, #2a5a8a);
            border-radius: 6px;
            border: 2px solid #f1f3f4;
        }}
        
        ::-webkit-scrollbar-thumb:hover {{
            background: linear-gradient(45deg, #1a4066, #255080);
        }}
        
        /* Loading animation */
        .loading-overlay {{
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255,255,255,0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            opacity: 1;
            transition: opacity 0.5s ease-out;
        }}
        
        .spinner {{
            width: 50px;
            height: 50px;
            border: 5px solid #e3f2fd;
            border-top: 5px solid #2196f3;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }}
        
        @keyframes spin {{
            0% {{ transform: rotate(0deg); }}
            100% {{ transform: rotate(360deg); }}
        }}
        
        /* Responsive adjustments */
        @media (max-width: 1200px) {{
            .chart-scroll-container {{
                padding: 15px;
            }}
            .header-title {{
                font-size: 20px;
            }}
        }}
        
        @media (max-height: 700px) {{
            .legend-container, .signature-container {{
                max-height: 250px;
                overflow-y: auto;
            }}
            .header-section {{
                padding: 10px 20px;
            }}
        }}                      
        
        @media (max-width: 768px) {{
            .main-container {{
                margin: 0;
            }}
            .chart-scroll-container,
            .legend-container,
            .signature-container {{
                margin: 0;
                border-radius: 0;
            }}
        }}
        
        /* Responsive Month Label Styles */
        .month-label {{
            transition: all 0.3s ease-in-out;
            display: inline-block;
        }}
        
        /* Desktop: Show every other month (priority 1) */
        @media (min-width: 1025px) {{
            .month-label-priority-2,
            .month-label-priority-3 {{
                display: none;
            }}
        }}
        
        /* Tablet: Show every 3rd month (priority 1 and 2) */
        @media (max-width: 1024px) and (min-width: 769px) {{
            .month-label-priority-3 {{
                display: none;
            }}
            .month-label {{
                transform: rotate(-15deg);
                font-size: 10px;
            }}
        }}
        
        /* Mobile: Show quarterly (priority 1 only, but less frequent) */
        @media (max-width: 768px) {{
            .month-label-priority-2,
            .month-label-priority-3 {{
                display: none;
            }}
            .month-label {{
                transform: rotate(-30deg);
                font-size: 9px;
                transform-origin: center bottom;
            }}
        }}
          /* Very small screens: Minimal labeling */
        @media (max-width: 480px) {{
            .month-label-priority-1[data-month-index]:not([data-month-index="0"]):not([data-month-index="6"]):not([data-month-index="12"]) {{
                display: none;
            }}
            .month-label {{
                transform: rotate(-45deg);
                font-size: 8px;
            }}
        }}
        
        /* Print styles to ensure colors show in PDF exports */
        @media print {{
            * {{
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
            }}
            
            body {{
                background: white !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            .header-section {{
                background: linear-gradient(135deg, #1f4e79 0%, #2a5a8a 100%) !important;
                background-color: #1f4e79 !important;
                color: white !important;
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
                box-shadow: none !important;
                border-bottom: 2px solid #1f4e79 !important;
            }}
            
            .header-title, .header-subtitle {{
                color: white !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            /* Ensure legend colors print correctly */
            .legend-container, .signature-container {{
                background: white !important;
                border: 1px solid #ddd !important;
                box-shadow: none !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            /* Ensure KPI dashboard colors print */
            .enhanced-kpi-dashboard {{
                background: #f8f9fa !important;
                -webkit-print-color-adjust: exact !important;
                box-shadow: none !important;
            }}
            
            .kpi-metric-card {{
                background: white !important;
                border: 1px solid #e0e6ed !important;
                box-shadow: none !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            /* Preserve border colors for KPI cards */
            .kpi-wells {{
                border-left: 5px solid #2196F3 !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            .kpi-rigs {{
                border-left: 5px solid #4CAF50 !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            .kpi-critical {{
                border-left: 5px solid #F44336 !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            .kpi-contracts {{
                border-left: 5px solid #FF9800 !important;
                -webkit-print-color-adjust: exact !important;
            }}
            
            .kpi-projects {{
                border-left: 5px solid #9C27B0 !important;
                -webkit-print-color-adjust: exact !important;
            }}
              /* Hide loading overlay and scrollbars in print */
            .loading-overlay {{
                display: none !important;
            }}
            
            /* Hide header and KPI sections in print for cleaner PDF */
            .header-section,
            .enhanced-kpi-dashboard {{
                display: none !important;
            }}
            
            ::-webkit-scrollbar {{
                display: none !important;
            }}
            
            /* Ensure chart container fits properly */
            .chart-scroll-container {{
                overflow: visible !important;
                box-shadow: none !important;
                min-height: auto !important;
            }}
            
            .chart-container {{
                min-width: auto !important;
                box-shadow: none !important;
            }}
              /* Optimize layout for print */
            .main-container {{
                height: auto !important;
                box-shadow: none !important;
            }}
            
            .content-wrapper {{
                overflow: visible !important;
                margin-top: 0 !important;
                padding-top: 0 !important;
            }}
            
            /* Adjust spacing when header/KPI are hidden */
            .chart-scroll-container {{
                margin-top: 20px !important;
            }}
        }}
        
        {signature_css}
        
        /* Enhanced KPI Dashboard Styles - Included from main file */
        {ChartExporter._get_kpi_dashboard_styles()}
    </style>
</head>
<body>
    <!-- Loading Overlay -->
    <div class="loading-overlay" id="loadingOverlay">
        <div style="text-align: center;">
            <div class="spinner"></div>
            <p style="margin-top: 20px; color: #666; font-weight: 500;">Loading Dashboard...</p>
        </div>                
    </div>                
      <div class="main-container">
        <div class="header-section">
            <h1 class="header-title">{header_title}</h1>
            <p class="header-subtitle">{header_subtitle}</p>
        </div>
        
        <!-- Enhanced KPI Dashboard -->
        {sticky_kpi_html}
        
        <div class="content-wrapper">
            <div class="chart-scroll-container">
                <div class="chart-container">
                    {html_content.split('<body>')[1].split('</body>')[0]}
                </div>
            </div>
            
            <div class="legend-container">
                {legend_html}
            </div>
            
            <div class="signature-container">
                {signature_html}
            </div>
        </div>
    </div>
    
    <script>
        {ChartExporter._get_javascript_code()}
        {signature_js}
    </script>
</body>
</html>"""
        
        # Write to file
        output_path = os.path.join(output_dir, "drilling_sequence.html")
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(full_html)

    @staticmethod
    def _get_kpi_dashboard_styles() -> str:
        """Get KPI dashboard CSS styles"""
        return """
        /* Enhanced KPI Dashboard Styles */
        .enhanced-kpi-dashboard {
            position: relative;
            width: 100%;
            background: linear-gradient(135deg, #f8f9fa 0%, #ffffff 100%);
            border-bottom: 3px solid #e9ecef;
            box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            transition: all 0.3s ease-in-out;
            margin: 0 0 35px 0;
            padding: 25px 0;
            border-radius: 0 0 12px 12px;
        }
        
        .kpi-main-header {
            max-width: 1400px;
            margin: 0 auto;
            padding: 25px 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 40px;
            position: relative;
        }
        
        .kpi-metrics-grid {
            display: flex;
            gap: 40px;
            flex: 1;
            justify-content: center;
            max-width: 950px;
        }
        
        .kpi-metric-card {
            background: linear-gradient(145deg, #ffffff 0%, #f8f9fa 100%);
            border-radius: 16px;
            padding: 18px 22px;
            width: 165px;
            height: 65px;
            display: flex;
            align-items: center;
            gap: 14px;
            border: 1px solid #e0e6ed;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06);
            border-left: 5px solid transparent;
            position: relative;
            overflow: hidden;
        }
        
        .kpi-metric-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .kpi-metric-card:hover {
            background: linear-gradient(145deg, #ffffff 0%, #f1f3f5 100%);
            transform: translateY(-3px) scale(1.02);
            box-shadow: 0 8px 25px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08);
            border-color: #d0d7de;
        }
        
        .kpi-metric-card:hover::before {
            opacity: 1;
        }
        
        .kpi-metric-content {
            flex: 1;
        }
        
        .kpi-metric-value {
            font-size: 26px;
            font-weight: 700;
            color: #1a202c;
            line-height: 1;
            text-shadow: 0 1px 2px rgba(0,0,0,0.05);
            transition: color 0.3s ease;
        }
        
        .kpi-metric-label {
            font-size: 13px;
            color: #4a5568;
            font-weight: 600;
            margin-top: 3px;
            line-height: 1;
            letter-spacing: 0.025em;
            transition: color 0.3s ease;
        }
        
        .kpi-metric-card:hover .kpi-metric-value {
            color: #0f172a;
        }
        
        .kpi-metric-card:hover .kpi-metric-label {
            color: #2d3748;
        }
        
        .kpi-metric-sublabel {
            font-size: 10px;
            color: #6c757d;
            font-weight: 400;
            margin-top: 2px;
            line-height: 1;
        }
        
        /* Semantic color variants for metric cards */
        .kpi-wells {
            border-left-color: #2196F3;
            background: linear-gradient(145deg, #f8fcff 0%, #ffffff 100%);
        }
        
        .kpi-wells:hover {
            border-left-color: #1976D2;
            background: linear-gradient(145deg, #e3f2fd 0%, #f8fcff 100%);
        }
        
        .kpi-rigs {
            border-left-color: #4CAF50;
            background: linear-gradient(145deg, #f8fff8 0%, #ffffff 100%);
        }
        
        .kpi-rigs:hover {
            border-left-color: #388E3C;
            background: linear-gradient(145deg, #e8f5e8 0%, #f8fff8 100%);
        }
        
        .kpi-critical {
            border-left-color: #F44336;
            background: linear-gradient(145deg, #fffafa 0%, #ffffff 100%);
        }
        
        .kpi-critical:hover {
            border-left-color: #D32F2F;
            background: linear-gradient(145deg, #ffebee 0%, #fffafa 100%);
        }
        
        .kpi-contracts {
            border-left-color: #FF9800;
            background: linear-gradient(145deg, #fffef8 0%, #ffffff 100%);
        }
        
        .kpi-contracts:hover {
            border-left-color: #F57C00;
            background: linear-gradient(145deg, #fff3e0 0%, #fffef8 100%);
        }
        
        .kpi-projects {
            border-left-color: #9C27B0;
            background: linear-gradient(145deg, #fefaff 0%, #ffffff 100%);
        }
        
        .kpi-projects:hover {
            border-left-color: #7B1FA2;
            background: linear-gradient(145deg, #f3e5f5 0%, #fefaff 100%);
        }
        
        /* Responsive design for KPI dashboard */
        @media (max-width: 1200px) {
            .kpi-main-header {
                padding: 15px 20px;
                gap: 20px;
            }
            
            .kpi-metrics-grid {
                gap: 12px;
            }
            
            .kpi-metric-card {
                min-width: 110px;
                padding: 12px 16px;
            }
            
            .kpi-metric-value {
                font-size: 20px;
            }
        }
        
        @media (max-width: 768px) {
            .kpi-main-header {
                flex-direction: column;
                padding: 12px 15px;
                gap: 15px;
                text-align: center;
            }
            
            .kpi-metrics-grid {
                order: 2;
                flex-wrap: wrap;
                justify-content: center;
                gap: 8px;
            }
            
            .kpi-metric-card {
                min-width: 90px;
                padding: 8px 12px;
                gap: 6px;
            }
            
            .kpi-metric-value {
                font-size: 16px;
            }
            
            .kpi-metric-label {
                font-size: 11px;
            }
        }
        
        @media (max-width: 480px) {
            .enhanced-kpi-dashboard {
                font-size: 12px;
            }
            
            .kpi-metrics-grid {
                gap: 6px;
            }
            
            .kpi-metric-card {
                min-width: 70px;
                padding: 6px 8px;
            }
            
            .kpi-metric-value {
                font-size: 14px;
            }
            
            .kpi-metric-label {
                font-size: 9px;
            }
        }
        """

    @staticmethod
    def _get_javascript_code() -> str:
        """Get comprehensive JavaScript code for responsive behavior"""
        return """            // Hide loading overlay after page loads
            window.addEventListener('load', function() {
                setTimeout(() => {
                    const overlay = document.getElementById('loadingOverlay');
                    overlay.style.opacity = '0';
                    setTimeout(() => overlay.style.display = 'none', 500);
                }, 1000);
            });
            
            // Print optimization for better PDF output
            window.addEventListener('beforeprint', function() {
                console.log('Preparing for print/PDF export...');
                
                // Ensure all background colors are preserved
                const elementsWithBackground = document.querySelectorAll('.header-section, .kpi-metric-card, .enhanced-kpi-dashboard');
                elementsWithBackground.forEach(el => {
                    el.style.webkitPrintColorAdjust = 'exact';
                    el.style.colorAdjust = 'exact';
                    el.style.printColorAdjust = 'exact';
                });
                
                // Optimize chart for print
                const chartDiv = document.querySelector('.plotly-graph-div');
                if (chartDiv && typeof Plotly !== 'undefined') {
                    try {
                        Plotly.relayout(chartDiv, {
                            'paper_bgcolor': 'white',
                            'plot_bgcolor': 'white'
                        });
                    } catch (error) {
                        console.warn('Print chart optimization error:', error);
                    }
                }
            });
            
            window.addEventListener('afterprint', function() {
                console.log('Print/PDF export completed');
            });
            
            // Smooth scroll behavior for chart navigation
            document.addEventListener('DOMContentLoaded', function() {
                const chartContainer = document.querySelector('.chart-scroll-container');
                if (chartContainer) {
                    chartContainer.style.scrollBehavior = 'smooth';
                }
                
                // Initialize responsive chart behavior
                initializeResponsiveChart();
                
                // Add print-friendly styles to document
                optimizeForPrint();
            });
            
            // Comprehensive responsive chart functionality
            function initializeResponsiveChart() {
                const chartDiv = document.querySelector('.plotly-graph-div');
                if (!chartDiv) return;
                
                let resizeTimeout;
                
                // Enhanced resize handler with debouncing and viewport optimization
                function handleResize() {
                    clearTimeout(resizeTimeout);
                    resizeTimeout = setTimeout(() => {
                        if (typeof Plotly !== 'undefined' && chartDiv) {
                            try {
                                // Get current viewport dimensions
                                const viewport = {
                                    width: window.innerWidth,
                                    height: window.innerHeight
                                };
                                
                                // Calculate responsive dimensions and margins
                                const chartConfig = calculateResponsiveConfig(viewport);
                                
                                // Apply responsive layout updates
                                Plotly.relayout(chartDiv, chartConfig);
                                
                                // Trigger responsive legend adjustments
                                adjustLegendForViewport(viewport);
                                
                                // Apply responsive month labeling
                                adjustMonthLabelsForViewport(viewport);
                                
                                console.log('Chart resized responsively for viewport:', viewport);
                            } catch (error) {
                                console.warn('Chart resize error:', error);
                            }
                        }
                    }, 150); // Debounce resize events
                }
                
                // Calculate responsive chart configuration based on viewport
                function calculateResponsiveConfig(viewport) {
                    const isMobile = viewport.width <= 768;
                    const isTablet = viewport.width > 768 && viewport.width <= 1024;
                    const isDesktop = viewport.width > 1024;
                    
                    let config = {
                        autosize: true,
                        'margin.t': 220,
                        'margin.b': 200,
                        'margin.l': 220,
                        'margin.r': 150
                    };
                    
                    // Responsive margin adjustments
                    if (isMobile) {
                        config = {
                            ...config,
                            'margin.t': 150,
                            'margin.b': 120,
                            'margin.l': 100,
                            'margin.r': 80
                        };
                    } else if (isTablet) {
                        config = {
                            ...config,
                            'margin.t': 170,
                            'margin.b': 170,
                            'margin.l': 180,
                            'margin.r': 120
                        };
                    }
                    
                    // Responsive title font size
                    const titleFontSize = isMobile ? 20 : isTablet ? 24 : 28;
                    config['title.font.size'] = titleFontSize;
                    
                    return config;
                }
                
                // Adjust legend visibility and layout for different viewports
                function adjustLegendForViewport(viewport) {
                    const legendContainer = document.querySelector('.legend-container');
                    const legendContent = document.getElementById('legend-content');
                    const legendToggle = document.getElementById('legend-toggle');
                    
                    if (!legendContainer || !legendContent || !legendToggle) return;
                    
                    const isMobile = viewport.width <= 768;
                    const isTablet = viewport.width > 768 && viewport.width <= 1024;
                    
                    // Auto-collapse legend on small screens for better chart visibility
                    if (isMobile && legendContent.style.display !== 'none') {
                        legendContent.style.display = 'none';
                        legendToggle.innerHTML = '▼ Expand';
                        legendToggle.style.background = 'rgba(40, 167, 69, 0.8)';
                    }
                    
                    // Adjust legend size based on viewport
                    if (isMobile) {
                        if (typeof setLegendSize === 'function') {
                            setLegendSize('compact');
                        }
                    } else if (isTablet) {
                        if (typeof setLegendSize === 'function') {
                            setLegendSize('normal');
                        }
                    }
                }
                
                // Adjust month labels visibility and style for different viewports
                function adjustMonthLabelsForViewport(viewport) {
                    const monthLabels = document.querySelectorAll('.month-label');
                    if (!monthLabels.length) return;
                    
                    const isMobile = viewport.width <= 768;
                    const isTablet = viewport.width > 768 && viewport.width <= 1024;
                    const isSmallMobile = viewport.width <= 480;
                    
                    monthLabels.forEach((label, index) => {
                        const priority = parseInt(label.getAttribute('data-priority') || '1');
                        const monthIndex = parseInt(label.getAttribute('data-month-index') || '0');
                        
                        // Reset styles first
                        label.style.display = '';
                        label.style.transform = '';
                        label.style.fontSize = '';
                        
                        // Apply responsive logic
                        if (isSmallMobile) {
                            // Very small screens: Show only key milestones (every 6 months)
                            if (monthIndex % 6 !== 0) {
                                label.style.display = 'none';
                            } else {
                                label.style.transform = 'rotate(-45deg)';
                                label.style.fontSize = '8px';
                                label.style.transformOrigin = 'center bottom';
                            }
                        } else if (isMobile) {
                            // Mobile: Show every 3-4 months with rotation
                            if (priority > 1) {
                                label.style.display = 'none';
                            } else {
                                label.style.transform = 'rotate(-30deg)';
                                label.style.fontSize = '9px';
                                label.style.transformOrigin = 'center bottom';
                            }
                        } else if (isTablet) {
                            // Tablet: Show every 2-3 months with slight rotation
                            if (priority > 2) {
                                label.style.display = 'none';
                            } else {
                                label.style.transform = 'rotate(-15deg)';
                                label.style.fontSize = '10px';
                                label.style.transformOrigin = 'center bottom';
                            }
                        } else {
                            // Desktop: Show every other month (priority 1 only)
                            if (priority > 1) {
                                label.style.display = 'none';
                            } else {
                                label.style.transform = 'none';
                                label.style.fontSize = '11px';
                            }
                        }
                    });
                    
                    console.log(`Adjusted month labels for ${isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop'} viewport`);
                }
                
                // Add resize event listeners
                window.addEventListener('resize', handleResize);
                window.addEventListener('orientationchange', function() {
                    setTimeout(handleResize, 300); // Delay for orientation change
                });
                
                // Initial responsive setup
                setTimeout(() => {
                    handleResize();
                }, 500);
            }
              // Enhanced scroll behavior for better UX
            function optimizeScrolling() {
                const chartContainer = document.querySelector('.chart-scroll-container');
                if (chartContainer) {
                    // Smooth scrolling with momentum
                    chartContainer.style.scrollBehavior = 'smooth';
                    chartContainer.style.webkitOverflowScrolling = 'touch';
                    
                    // Optional: Add scroll position memory
                    let scrollPosition = 0;
                    chartContainer.addEventListener('scroll', function() {
                        scrollPosition = this.scrollLeft;
                    });
                }
            }
            
            // Print optimization function
            function optimizeForPrint() {
                // Add print-specific meta tag for color preservation
                const printMeta = document.createElement('meta');
                printMeta.name = 'color-scheme';
                printMeta.content = 'normal';
                document.head.appendChild(printMeta);
                
                // Ensure all elements with backgrounds are print-ready
                const backgroundElements = [
                    '.header-section',
                    '.kpi-metric-card',
                    '.enhanced-kpi-dashboard',
                    '.legend-container',
                    '.signature-container'
                ];
                
                backgroundElements.forEach(selector => {
                    const elements = document.querySelectorAll(selector);
                    elements.forEach(el => {
                        el.style.webkitPrintColorAdjust = 'exact';
                        el.style.colorAdjust = 'exact';
                        el.style.printColorAdjust = 'exact';
                    });
                });
                
                console.log('Print optimization applied - colors should now appear in PDF exports');
            }
              
            // Initialize all enhancements
            document.addEventListener('DOMContentLoaded', function() {
                optimizeScrolling();
            });
        """
