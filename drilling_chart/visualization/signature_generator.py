"""
Signature section generator for drilling sequence charts.

This module provides the SignatureGenerator class that creates collapsible
signature and document control sections for HTML chart exports.
"""

from datetime import datetime
from typing import Optional


class SignatureGenerator:
    """Generates collapsible signature and document control sections for chart exports"""
    
    def __init__(self):
        """Initialize the signature generator"""
        pass
    
    def _calculate_responsive_styles(self, chart_width: int = None) -> dict:
        """Calculate responsive styling for signature section based on chart width"""
        if chart_width is None:
            # Default values when chart width is not provided - Ultra compact
            return {
                'gap': 6,
                'margin': 8,
                'padding': 8,
                'header_font_size': 12,
                'subheader_font_size': 10,
                'text_font_size': 10,
                'small_text_font_size': 9,
                'table_font_size': 10,
                'layout': ''
            }
          # Responsive scaling based on chart width
        if chart_width < 1200:  # Small screens
            return {
                'gap': 8,
                'margin': 8,
                'padding': 10,
                'header_font_size': 14,
                'subheader_font_size': 12,
                'text_font_size': 10,
                'small_text_font_size': 9,
                'table_font_size': 10,
                'layout': 'flex-wrap: wrap;'
            }
        elif chart_width < 2000:  # Medium screens
            return {
                'gap': 10,
                'margin': 12,
                'padding': 12,
                'header_font_size': 15,
                'subheader_font_size': 13,
                'text_font_size': 11,
                'small_text_font_size': 10,
                'table_font_size': 11,
                'layout': ''
            }
        else:  # Large screens
            return {
                'gap': 15,
                'margin': 18,
                'padding': 16,
                'header_font_size': 18,
                'subheader_font_size': 16,
                'text_font_size': 13,
                'small_text_font_size': 12,
                'table_font_size': 12,
                'layout': ''
            }
    
    def generate_signature_html(self, document_title: str = "Drilling Sequence Chart",
                               revision: str = "Rev. 01", chart_width: int = None) -> str:
        """
        Generate collapsible signature section HTML
        
        Args:
            document_title: Title of the document
            revision: Document revision number
            chart_width: Width of the chart for responsive styling
            
        Returns:
            HTML string for the signature section
        """
        current_date = datetime.now().strftime("%B %d, %Y")
          # Calculate responsive legend styling based on chart width
        signature_styles = self._calculate_responsive_styles(chart_width)
        return f"""
        <div class="signature-section-wrapper" style="font-family: 'Roboto', Arial, sans-serif; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; border: 1px solid #dee2e6; box-shadow: 0 4px 12px rgba(0,0,0,0.08); margin: {signature_styles['margin']}px;">
            <!-- Signature Header with Controls -->
            <div class="signature-toggle-header" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 16px 6px 16px; border-bottom: 1px solid #dee2e6; background: linear-gradient(90deg, #495057 0%, #6c757d 100%); border-radius: 12px 12px 0 0; color: white; transition: all 0.3s ease;">
                <div>
                    <h2 class="signature-title" style="margin: 0; font-size: {signature_styles['header_font_size']}px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.1); display: flex; align-items: center;">
                        <span class="signature-icon" style="background: linear-gradient(45deg, #28a745, #20c997); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-right: 10px;">📋</span>
                        Document Control & Signatures
                    </h2>
                    <p class="signature-subtitle" style="margin: 2px 0 0 30px; opacity: 0.9; font-weight: 300; font-size: {signature_styles['small_text_font_size']}px;">Document control and approval signatures</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <!-- Size Control Buttons -->
                    <div style="display: flex; background: rgba(255,255,255,0.15); border-radius: 6px; padding: 2px;">
                        <button id="signature-compact" onclick="setSignatureSize('compact')" 
                                style="background: none; border: none; color: white; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.2s;" 
                                onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='none'">
                            Compact
                        </button>
                        <button id="signature-normal" onclick="setSignatureSize('normal')" 
                                style="background: rgba(255,255,255,0.25); border: none; color: white; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.2s;">
                            Normal
                        </button>
                        <button id="signature-detailed" onclick="setSignatureSize('detailed')" 
                                style="background: none; border: none; color: white; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; transition: background 0.2s;" 
                                onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='none'">
                            Detailed
                        </button>
                    </div>
                    <!-- Collapse Toggle Button -->
                    <button id="signatureToggleBtn" onclick="toggleSignatureSection()" 
                            style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                        ▲ Collapse
                    </button>
                </div>
            </div>
            
            <!-- Signature Content -->
            <div id="signatureContent" class="signature-content" style="display: flex; flex-direction: column; gap: {signature_styles['gap']}px; padding: {signature_styles['padding']}px; background: #fafbfc; border-top: 1px solid #dee2e6; max-height: 500px; overflow: hidden; transition: all 0.4s ease;">
                {self._generate_document_control_section(document_title, revision, current_date, signature_styles)}
                {self._generate_approval_signatures_section(signature_styles)}
                {self._generate_signature_footer(signature_styles)}
            </div>        </div>
        """
    
    def _generate_document_control_section(self, document_title: str, revision: str, current_date: str, signature_styles: dict) -> str:
        """Generate document control section HTML"""
        return f"""
        <!-- Document Control Section -->        <div class="document-control-section" style="margin-bottom: 8px; background: white; padding: 8px; border-radius: 6px; box-shadow: 0 1px 6px rgba(0,0,0,0.05);">
            <h4 class="control-section-title" style="margin: 0 0 8px 0; font-size: {signature_styles['subheader_font_size']}px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6; padding-bottom: 4px; display: flex; align-items: center;">
                <span style="background: linear-gradient(45deg, #007bff, #0056b3); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-right: 8px;">🔧</span>
                Document Control
            </h4>
            <table class="document-control-table" style="width: 100%; border-collapse: collapse; font-size: {signature_styles['table_font_size']}px;">
                <tr>                    <td class="control-label" style="background: #f8f9fa; font-weight: 600; color: #495057; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">Document Title:</td>
                    <td class="control-value" style="background: white; color: #212529; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">{document_title}</td>
                    <td class="control-label" style="background: #f8f9fa; font-weight: 600; color: #495057; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">Revision:</td>
                    <td class="control-value" style="background: white; color: #212529; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">{revision}</td>
                </tr>
                <tr>                    <td class="control-label" style="background: #f8f9fa; font-weight: 600; color: #495057; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">Generated Date:</td>
                    <td class="control-value" style="background: white; color: #212529; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">{current_date}</td>
                    <td class="control-label" style="background: #f8f9fa; font-weight: 600; color: #495057; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">Valid Until:</td>
                    <td class="control-value" style="background: white; color: #212529; width: 25%; padding: 4px 8px; border: 1px solid #dee2e6;">Next Review</td>
                </tr>
            </table>        </div>
        """
    
    def _generate_approval_signatures_section(self, signature_styles: dict) -> str:
        """Generate approval signatures table HTML"""
        roles = [
            "General Manager",
            "Corporate Portfolio and Planning Manager", 
            "HSE Manager",
            "Technical Manager",
            "Operations Manager"
        ]
        
        signature_rows = ""
        for role in roles:
            signature_rows += f"""
                            <tr style="transition: background-color 0.2s ease;">
                                <td class="role-cell" style="width: 25%; font-weight: 600; color: #495057; padding: 12px 8px; border: 1px solid #dee2e6; background: white; min-height: 40px;">{role}</td>
                                <td class="name-cell" style="width: 25%; padding: 12px 8px; border: 1px solid #dee2e6; background: white; min-height: 40px;"></td>
                                <td class="signature-cell" style="width: 30%; padding: 12px 8px; border: 1px solid #dee2e6; background: white; min-height: 40px;"></td>
                                <td class="date-cell" style="width: 20%; padding: 12px 8px; border: 1px solid #dee2e6; background: white; min-height: 40px;"></td>
                            </tr>"""
        
        return f"""
        <!-- Signature Section -->        <div class="approval-signatures-section" style="background: white; padding: 8px; border-radius: 6px; box-shadow: 0 1px 6px rgba(0,0,0,0.05); margin-bottom: 8px;">
            <h4 class="approval-section-title" style="margin: 0 0 8px 0; font-size: {signature_styles['subheader_font_size']}px; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6; padding-bottom: 4px; display: flex; align-items: center;">
                <span style="background: linear-gradient(45deg, #6f42c1, #e83e8c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; margin-right: 8px;">✍️</span>
                Approval Signatures
            </h4>
            <table class="approval-signatures-table" style="width: 100%; border-collapse: collapse; font-size: {signature_styles['table_font_size']}px;">
                <thead>
                    <tr>                        <th class="role-header" style="background: linear-gradient(90deg, #495057 0%, #6c757d 100%); color: white; padding: 6px 4px; text-align: left; font-weight: 600; border: 1px solid #6c757d; width: 25%;">Role</th>
                        <th class="name-header" style="background: linear-gradient(90deg, #495057 0%, #6c757d 100%); color: white; padding: 6px 4px; text-align: left; font-weight: 600; border: 1px solid #6c757d; width: 25%;">Name</th>
                        <th class="signature-header" style="background: linear-gradient(90deg, #495057 0%, #6c757d 100%); color: white; padding: 6px 4px; text-align: left; font-weight: 600; border: 1px solid #6c757d; width: 30%;">Signature</th>
                        <th class="date-header" style="background: linear-gradient(90deg, #495057 0%, #6c757d 100%); color: white; padding: 6px 4px; text-align: left; font-weight: 600; border: 1px solid #6c757d; width: 20%;">Date</th>
                    </tr>
                </thead>
                <tbody>{signature_rows}
                </tbody>
            </table>        </div>
        """
    
    def _generate_signature_footer(self, signature_styles: dict) -> str:
        """Generate signature section footer HTML"""
        return f"""
        <!-- Footer Note -->
        <div class="signature-footer-note" style="background: #e8f5e8; padding: 12px 15px; border-radius: 6px; border-left: 4px solid #495057;">
            <p style="margin: 0; font-size: {signature_styles['small_text_font_size']}px; color: #495057; font-style: italic; line-height: 1.4;">This document is electronically generated and valid without physical signatures when approved through the digital workflow system.</p>        </div>
        """
    
    def get_signature_css(self) -> str:
        """
        Get CSS styles for the signature section matching legend generator styling
        
        Returns:
            CSS string for signature section styling
        """
        return """
                    /* Signature Section Styles - Matching Legend Generator */
                    .signature-section-wrapper {
                        font-family: 'Roboto', Arial, sans-serif; 
                        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); 
                        border-radius: 12px; 
                        border: 1px solid #dee2e6; 
                        box-shadow: 0 4px 12px rgba(0,0,0,0.08); 
                        overflow: hidden;
                    }
                    
                    .signature-toggle-header {
                        background: linear-gradient(90deg, #495057 0%, #6c757d 100%);
                        color: white;
                        padding: 16px 20px 12px 20px;
                        cursor: pointer;
                        transition: all 0.3s ease;
                        border-bottom: 1px solid rgba(255,255,255,0.1);
                        border-radius: 12px 12px 0 0;
                    }
                    
                    .signature-toggle-header:hover {
                        background: linear-gradient(90deg, #3a3f44 0%, #5a6268 100%);
                        transform: translateY(-1px);
                        box-shadow: 0 4px 12px rgba(73, 80, 87, 0.3);
                    }
                    
                    .signature-title {
                        margin: 0;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    }
                    
                    .signature-icon {
                        background: linear-gradient(45deg, #28a745, #20c997); 
                        -webkit-background-clip: text; 
                        -webkit-text-fill-color: transparent; 
                        background-clip: text;
                        margin-right: 10px;
                    }                      .signature-subtitle {
                        margin: 2px 0 0 30px;
                        opacity: 0.9;
                        font-weight: 300;
                    }
                    
                    .signature-content {
                        background: #fafbfc;
                        border-top: 1px solid #dee2e6;
                        transition: all 0.3s ease-in-out;
                    }
                      /* Document Control Section */
                    .document-control-section {
                        margin-bottom: 8px;
                        background: white;
                        padding: 8px;
                        border-radius: 6px;
                        box-shadow: 0 1px 6px rgba(0,0,0,0.05);
                    }
                      .control-section-title {
                        margin: 0 0 8px 0;
                        font-weight: 600;
                        color: #495057;
                        border-bottom: 2px solid #dee2e6;
                        padding-bottom: 4px;
                        display: flex;
                        align-items: center;
                    }
                    
                    .document-control-table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                      .document-control-table td {
                        padding: 4px 8px;
                        border: 1px solid #dee2e6;
                    }
                    
                    .control-label {
                        background: #f8f9fa;
                        font-weight: 600;
                        color: #495057;
                        width: 25%;
                    }
                    
                    .control-value {
                        background: white;
                        color: #212529;
                        width: 25%;
                    }
                      /* Approval Signatures Section */
                    .approval-signatures-section {
                        background: white;
                        padding: 8px;
                        border-radius: 6px;
                        box-shadow: 0 1px 6px rgba(0,0,0,0.05);
                        margin-bottom: 8px;
                    }
                      .approval-section-title {
                        margin: 0 0 8px 0;
                        font-weight: 600;
                        color: #495057;
                        border-bottom: 2px solid #dee2e6;
                        padding-bottom: 4px;
                        display: flex;
                        align-items: center;
                    }
                    
                    .approval-signatures-table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                      .approval-signatures-table th {
                        background: linear-gradient(90deg, #495057 0%, #6c757d 100%);
                        color: white;
                        padding: 6px 4px;
                        text-align: left;
                        font-weight: 600;
                        border: 1px solid #6c757d;
                    }
                      .approval-signatures-table td {
                        padding: 4px 8px;
                        border: 1px solid #dee2e6;
                        background: white;
                        min-height: 30px;
                    }
                    
                    .role-header, .role-cell {
                        width: 25%;
                        font-weight: 600;
                        color: #495057;
                    }
                    
                    .name-header, .name-cell {
                        width: 25%;
                    }
                    
                    .signature-header, .signature-cell {
                        width: 30%;
                    }
                    
                    .date-header, .date-cell {
                        width: 20%;
                    }
                    
                    .approval-signatures-table tbody tr:nth-child(even) {
                        background: #f8f9fa;
                    }
                    
                    .approval-signatures-table tbody tr:hover {
                        background: #e3f2fd;
                        transition: background-color 0.2s ease;
                    }
                      /* Signature Footer */
                    .signature-footer-note {
                        background: #e8f5e8;
                        padding: 6px 8px;
                        border-radius: 6px;
                        border-left: 4px solid #495057;
                    }
                    
                    .signature-footer-note p {
                        margin: 0;
                        color: #495057;
                        font-style: italic;
                        line-height: 1.4;
                    }
                    
                    /* Responsive adjustments for signature section */
                    @media (max-width: 768px) {
                        .signature-toggle-header {
                            padding: 12px 15px;
                        }
                        
                        .signature-title {
                            font-size: 16px;
                        }
                        
                        .signature-content {
                            padding: 15px;
                        }
                        
                        .document-control-table,
                        .approval-signatures-table {
                            font-size: 12px;
                        }
                          .document-control-table td,
                        .approval-signatures-table th,
                        .approval-signatures-table td {
                            padding: 3px 2px;
                        }
                    }
        """
    
    def get_signature_javascript(self) -> str:
        """
        Get JavaScript for signature section functionality matching legend generator
        
        Returns:
            JavaScript string for signature section interactivity
        """
        return """
            // Signature section toggle functionality - Exactly matching Legend Generator
            let signatureState = 'normal';
            let signatureIsCollapsed = true; // Start collapsed by default
            
            function toggleSignatureSection() {
                const content = document.getElementById('signatureContent');
                const button = document.getElementById('signatureToggleBtn');
                
                if (signatureIsCollapsed) {
                    content.style.display = 'block';
                    button.innerHTML = '▲ Collapse';
                    button.style.background = 'rgba(255,255,255,0.15)';
                    signatureIsCollapsed = false;
                } else {
                    content.style.display = 'none';
                    button.innerHTML = '▼ Expand';
                    button.style.background = 'rgba(73, 80, 87, 0.8)';
                    signatureIsCollapsed = true;
                }
            }
            
            function setSignatureSize(size) {
                const content = document.getElementById('signatureContent');
                const buttons = ['signature-compact', 'signature-normal', 'signature-detailed'];
                
                // Reset all button styles
                buttons.forEach(id => {
                    const btn = document.getElementById(id);
                    btn.style.background = 'none';
                    btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.2)';
                    btn.onmouseout = () => btn.style.background = 'none';
                });
                
                // Set active button style
                const activeBtn = document.getElementById('signature-' + size);
                activeBtn.style.background = 'rgba(255,255,255,0.25)';
                activeBtn.onmouseover = null;
                activeBtn.onmouseout = null;
                
                // Apply size-specific styles
                switch(size) {
                    case 'compact':
                        content.style.padding = '12px';
                        content.style.fontSize = '11px';
                        content.querySelectorAll('h4').forEach(h => h.style.fontSize = '14px');
                        content.querySelectorAll('table').forEach(t => t.style.fontSize = '11px');
                        break;
                    case 'normal':
                        content.style.padding = '20px';
                        content.style.fontSize = '13px';
                        content.querySelectorAll('h4').forEach(h => h.style.fontSize = '16px');
                        content.querySelectorAll('table').forEach(t => t.style.fontSize = '13px');
                        break;
                    case 'detailed':
                        content.style.padding = '28px';
                        content.style.fontSize = '14px';
                        content.querySelectorAll('h4').forEach(h => h.style.fontSize = '18px');
                        content.querySelectorAll('table').forEach(t => t.style.fontSize = '14px');
                        break;
                }
                signatureState = size;
            }
              // Initialize with normal size and collapsed state
            document.addEventListener('DOMContentLoaded', function() {
                setSignatureSize('normal');
                // Start collapsed by default
                const content = document.getElementById('signatureContent');
                const button = document.getElementById('signatureToggleBtn');
                content.style.display = 'none';
                button.innerHTML = '▼ Expand';
                button.style.background = 'rgba(73, 80, 87, 0.8)';
            });
            
            // Auto-collapse on small screens
            function checkSignatureScreenSize() {
                if (window.innerWidth < 768 && !signatureIsCollapsed) {
                    toggleSignatureSection();
                }
            }
            
            window.addEventListener('resize', checkSignatureScreenSize);
            window.addEventListener('load', checkSignatureScreenSize);
        """
