"""
Streamlit App for Drilling Chart Generator
"""

import streamlit as st
import pandas as pd
import tempfile
import os

# Import the correct classes from the drilling_chart package
from drilling_chart import DataProcessor, ChartGenerator, ColorManager, ChartExporter

def main():
    st.set_page_config(
        page_title="Timeline Chart Generator",
        page_icon="📊",
        layout="wide",
        initial_sidebar_state="collapsed"
    )
    
    # Enhanced CSS styling for professional appearance
    st.markdown("""
    <style>
    /* Import Google Fonts */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    
    /* Main app styling */
    .stApp {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        font-family: 'Inter', sans-serif;
    }
    
    /* Main content container */
    .main > div {
        background: white;
        padding: 2rem;
        border-radius: 20px;
        margin: 1rem;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);
        max-width: 1400px;
        margin: 1rem auto;
    }
    
    /* Header styling */
    .main-header {
        text-align: center;
        padding: 2rem 0;
        margin-bottom: 2rem;
        border-bottom: 2px solid #f0f2f6;
    }
    
    .main-title {
        font-size: 3rem;
        font-weight: 700;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.5rem;
    }
    
    .main-subtitle {
        font-size: 1.2rem;
        color: #6c757d;
        font-weight: 400;
    }
    
    /* Card styling */
    .custom-card {
        background: white;
        border-radius: 12px;
        padding: 1.5rem;
        margin: 1rem 0;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
        border: 1px solid #e9ecef;
        transition: all 0.3s ease;
        animation: fadeInUp 0.6s ease-out;
    }
    
    .custom-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
    }
    
    .card-header {
        font-size: 1.4rem;
        font-weight: 600;
        color: #2c3e50;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    /* Enhanced file uploader styling */
    .stFileUploader > div > div {
        background: linear-gradient(135deg, #f8f9ff 0%, #e3f2fd 100%);
        border: 2px dashed #667eea;
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        transition: all 0.3s ease;
    }
    
    .stFileUploader > div > div:hover {
        border-color: #764ba2;
        background: linear-gradient(135deg, #f3e5f5 0%, #e8f5e8 100%);
        transform: translateY(-2px);
    }
    
    /* Button styling */
    .stButton > button {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 12px;
        padding: 0.75rem 2rem;
        font-weight: 600;
        font-size: 1.1rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    }
    
    .stButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4);
    }
    
    /* Input field styling */
    .stTextInput > div > div > input,
    .stTextArea > div > div > textarea {
        border-radius: 8px;
        border: 2px solid #e9ecef;
        transition: all 0.3s ease;
    }
    
    .stTextInput > div > div > input:focus,
    .stTextArea > div > div > textarea:focus {
        border-color: #667eea;
        box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
    }
    
    /* Enhanced selectbox styling */
    .stSelectbox > div > div > div {
        border-radius: 8px;
        border: 2px solid #e9ecef;
        transition: all 0.3s ease;
    }
    
    .stSelectbox > div > div > div:focus-within {
        border-color: #667eea;
        box-shadow: 0 0 0 0.2rem rgba(102, 126, 234, 0.25);
    }
    
    /* Enhanced metrics styling */
    .metric-container {
        background: linear-gradient(135deg, #f8f9ff 10%, #ffffff 100%);
        border-radius: 16px;
        padding: 1.5rem;
        text-align: center;
        border: 1px solid #e9ecef;
        margin: 0.5rem 0;
        position: relative;
        overflow: hidden;
        transition: all 0.3s ease;
    }
    
    .metric-container:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 35px rgba(0, 0, 0, 0.1);
    }
    
    .metric-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    
    /* Success message styling */
    .stSuccess {
        background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
        border: 1px solid #c3e6cb;
        border-radius: 12px;
        padding: 1rem;
    }
    
    /* Info message styling */
    .stInfo {
        background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%);
        border: 1px solid #bee5eb;
        border-radius: 12px;
        padding: 1rem;
    }
    
    /* Progress bar styling */
    .stProgress > div > div > div > div {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 6px;
    }
    
    /* Dataframe styling */
    .stDataFrame {
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
    }
    
    /* Section dividers */
    hr {
        border: none;
        height: 2px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        margin: 2rem 0;
        border-radius: 1px;
    }
    
    /* Custom animations */
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    /* Loading spinner animation */
    .loading-spinner {
        border: 4px solid #f3f3f3;
        border-top: 4px solid #667eea;
        border-radius: 50%;
        width: 40px;
        height: 40px;
        animation: spin 1s linear infinite;
        margin: 20px auto;
    }
    
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    
    /* Hide Streamlit branding */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    
    /* Custom spacing */
    .block-container {
        padding-top: 1rem;
        padding-bottom: 0rem;
    }
    </style>
    """, unsafe_allow_html=True)
    
    # Enhanced header with professional styling
    st.markdown("""
    <div class="main-header">
        <h1 class="main-title">📊 Timeline Chart Generator</h1>
        <p class="main-subtitle">Transform your project data into professional interactive timelines</p>
    </div>
    """, unsafe_allow_html=True)
    
    # File upload section with enhanced styling
    st.markdown("""
    <div class="custom-card">
        <div class="card-header">
            📁 Data Upload
        </div>
        <p style="color: #6c757d; margin-bottom: 1rem;">
            Upload your CSV file to get started. Drag and drop or click to browse.
        </p>
    </div>
    """, unsafe_allow_html=True)
    
    uploaded_file = st.file_uploader(
        "Upload your timeline data CSV file",
        type=['csv'],
        help="CSV file should contain timeline data with required columns (Activity Type, Start Date, End Date)",
        label_visibility="collapsed"
    )
    
    if uploaded_file is not None:
        try:
            # Save uploaded file to temporary location
            with tempfile.NamedTemporaryFile(mode='wb', delete=False, suffix='.csv') as tmp_file:
                tmp_file.write(uploaded_file.getvalue())
                temp_csv_path = tmp_file.name
            
            st.success("✅ File uploaded successfully!")
            
            # Show a preview of the data with enhanced styling
            df = pd.read_csv(temp_csv_path)
            
            st.markdown("""
            <div class="custom-card">
                <div class="card-header">
                    👀 Data Preview & Analytics
                </div>
                <p style="color: #6c757d; margin-bottom: 1rem;">
                    Here's what we found in your data
                </p>
            </div>
            """, unsafe_allow_html=True)
            
            # Enhanced data summary metrics
            col1, col2, col3, col4 = st.columns(4)
            with col1:
                st.markdown(f"""
                <div class="metric-container">
                    <h3 style="color: #667eea; margin: 0; font-size: 2rem;">{len(df):,}</h3>
                    <p style="margin: 0; color: #6c757d; font-weight: 500;">Total Rows</p>
                </div>
                """, unsafe_allow_html=True)
            
            with col2:
                st.markdown(f"""
                <div class="metric-container">
                    <h3 style="color: #764ba2; margin: 0; font-size: 2rem;">{len(df.columns)}</h3>
                    <p style="margin: 0; color: #6c757d; font-weight: 500;">Columns</p>
                </div>
                """, unsafe_allow_html=True)
            
            with col3:
                activity_types = df['Activity Type'].nunique() if 'Activity Type' in df.columns else 0
                st.markdown(f"""
                <div class="metric-container">
                    <h3 style="color: #28a745; margin: 0; font-size: 2rem;">{activity_types}</h3>
                    <p style="margin: 0; color: #6c757d; font-weight: 500;">Activity Types</p>
                </div>
                """, unsafe_allow_html=True)
            
            with col4:
                if 'Start Date' in df.columns and 'End Date' in df.columns:
                    try:
                        df['Start Date'] = pd.to_datetime(df['Start Date'])
                        df['End Date'] = pd.to_datetime(df['End Date'])
                        date_range = (df['End Date'].max() - df['Start Date'].min()).days
                        st.markdown(f"""
                        <div class="metric-container">
                            <h3 style="color: #ffc107; margin: 0; font-size: 2rem;">{date_range:,}</h3>
                            <p style="margin: 0; color: #6c757d; font-weight: 500;">Days Span</p>
                        </div>
                        """, unsafe_allow_html=True)
                    except:
                        st.markdown("""
                        <div class="metric-container">
                            <h3 style="color: #dc3545; margin: 0; font-size: 2rem;">⚠️</h3>
                            <p style="margin: 0; color: #6c757d; font-weight: 500;">Date Format</p>
                        </div>
                        """, unsafe_allow_html=True)
            
            # Enhanced data preview
            st.markdown("##### 📋 Data Sample")
            st.dataframe(df.head(), use_container_width=True)
            
            # Chart Customization Section with enhanced styling
            st.markdown("---")
            
            st.markdown("""
            <div class="custom-card">
                <div class="card-header">
                    ⚙️ Chart Customization
                </div>
                <p style="color: #6c757d; margin-bottom: 1rem;">
                    Customize your chart appearance and document details
                </p>
            </div>
            """, unsafe_allow_html=True)
            
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown("""
                <div style="background: linear-gradient(135deg, #f8f9ff 0%, #ffffff 100%); 
                           padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; border: 1px solid #e9ecef;">
                    <h4 style="color: #667eea; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                        📊 Chart Settings
                    </h4>
                </div>
                """, unsafe_allow_html=True)
                
                chart_title = st.text_input(
                    "Chart Title",
                    value="",
                    help="Title that appears at the top of the chart (leave blank for auto-generation)",
                    placeholder="e.g., Project Timeline 2024"
                )
                
                dashboard_title = st.text_input(
                    "Dashboard Header Title",
                    value="",
                    help="Main title in the exported HTML dashboard (leave blank for auto-generation)",
                    placeholder="e.g., Drilling Operations Dashboard"
                )
                
                dashboard_subtitle = st.text_input(
                    "Dashboard Subtitle",
                    value="",
                    help="Subtitle in the exported HTML dashboard (leave blank for auto-generation)",
                    placeholder="e.g., Q4 2024 Operations Schedule"
                )
                
                document_title = st.text_input(
                    "Document Title",
                    value="Timeline Chart",
                    help="Document title for signatures and control section"
                )
                
                document_revision = st.text_input(
                    "Document Revision",
                    value="Rev. 01",
                    help="Document revision number"
                )
            
            with col2:
                st.markdown("""
                <div style="background: linear-gradient(135deg, #fff8f0 0%, #ffffff 100%); 
                           padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; border: 1px solid #e9ecef;">
                    <h4 style="color: #764ba2; margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
                        ✍️ Signatory Roles
                    </h4>
                </div>
                """, unsafe_allow_html=True)
                
                default_roles = [
                    "General Manager",
                    "Corporate Portfolio and Planning Manager", 
                    "HSE Manager",
                    "Technical Manager",
                    "Operations Manager"
                ]
                
                signatory_roles = st.text_area(
                    "Signatory Roles (one per line)",
                    value="\n".join(default_roles),
                    height=180,
                    help="Enter each signatory role on a new line"
                )
                
                # Convert textarea input to list
                roles_list = [role.strip() for role in signatory_roles.split('\n') if role.strip()]
            
            # Generate Chart Button with enhanced styling
            st.markdown("---")
            
            st.markdown("""
            <div class="custom-card" style="text-align: center; background: linear-gradient(135deg, #f8f9ff 0%, #e3f2fd 100%);">
                <div class="card-header" style="justify-content: center;">
                    🚀 Ready to Generate Your Chart?
                </div>
                <p style="color: #6c757d; margin-bottom: 1.5rem; font-size: 1.1rem;">
                    Your interactive timeline chart will include professional styling, KPI dashboards, and export-ready formatting
                </p>
            </div>
            """, unsafe_allow_html=True)
            
            col1, col2, col3 = st.columns([1, 2, 1])
            
            with col2:
                if st.button("🚀 Generate Timeline Chart", type="primary", use_container_width=True):
                    # Create customization parameters
                    customization = {
                        'chart_title': chart_title if chart_title.strip() else None,
                        'dashboard_title': dashboard_title if dashboard_title.strip() else None,
                        'dashboard_subtitle': dashboard_subtitle if dashboard_subtitle.strip() else None,
                        'html_document_title': dashboard_title if dashboard_title.strip() else None,
                        'document_title': document_title,
                        'document_revision': document_revision,
                        'signatory_roles': roles_list
                    }
                    generate_chart(temp_csv_path, customization)
            
            # Clean up temp file after potential chart generation
            if os.path.exists(temp_csv_path):
                os.unlink(temp_csv_path)
            
        except Exception as e:
            st.error(f"❌ Error processing file: {str(e)}")
            st.info("💡 **Tip:** Make sure your CSV has the required columns: Start Date, End Date, and Activity Type")
    
    else:
        # Enhanced welcome section when no file is uploaded
        st.markdown("""
        <div class="custom-card" style="text-align: center; background: linear-gradient(135deg, #f8f9ff 0%, #e3f2fd 100%);">
            <div style="padding: 2.5rem;">
                <div style="font-size: 4rem; margin-bottom: 1rem;">📤</div>
                <h2 style="color: #667eea; margin-bottom: 1rem; font-size: 2.5rem;">Get Started</h2>
                <p style="color: #6c757d; font-size: 1.2rem; margin-bottom: 2.5rem; max-width: 600px; margin-left: auto; margin-right: auto;">
                    Upload your CSV file to create professional interactive timeline charts with KPI dashboards and export capabilities
                </p>
                <div style="background: white; border-radius: 16px; padding: 2rem; margin: 2rem 0; border: 1px solid #e9ecef; max-width: 800px; margin-left: auto; margin-right: auto;">
                    <h4 style="color: #2c3e50; margin-bottom: 1.5rem; font-size: 1.3rem;">📋 Required CSV Columns</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; text-align: left;">
                        <div style="background: #f8f9ff; padding: 1rem; border-radius: 8px; border-left: 4px solid #667eea;">
                            <strong style="color: #667eea; font-size: 1.1rem;">📅 Start Date</strong><br>
                            <small style="color: #6c757d;">YYYY-MM-DD format</small><br>
                            <small style="color: #28a745; font-style: italic;">e.g., 2024-01-15</small>
                        </div>
                        <div style="background: #f8f9ff; padding: 1rem; border-radius: 8px; border-left: 4px solid #667eea;">
                            <strong style="color: #667eea; font-size: 1.1rem;">📅 End Date</strong><br>
                            <small style="color: #6c757d;">YYYY-MM-DD format</small><br>
                            <small style="color: #28a745; font-style: italic;">e.g., 2024-02-28</small>
                        </div>
                        <div style="background: #f8f9ff; padding: 1rem; border-radius: 8px; border-left: 4px solid #667eea;">
                            <strong style="color: #667eea; font-size: 1.1rem;">🏷️ Activity Type</strong><br>
                            <small style="color: #6c757d;">Type of activity</small><br>
                            <small style="color: #28a745; font-style: italic;">e.g., Drilling, Testing</small>
                        </div>
                    </div>
                </div>
                <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; padding: 1.5rem; margin: 1.5rem 0;">
                    <h5 style="color: #28a745; margin-bottom: 1rem; font-size: 1.2rem;">✨ Enhanced Features Available</h5>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; text-align: left;">
                        <div>📊 <strong>Interactive Charts</strong></div>
                        <div>📱 <strong>Responsive Design</strong></div>
                        <div>🖨️ <strong>Print Optimization</strong></div>
                        <div>📈 <strong>KPI Dashboards</strong></div>
                        <div>✍️ <strong>Digital Signatures</strong></div>
                        <div>🎨 <strong>Custom Styling</strong></div>
                    </div>
                    <p style="color: #6c757d; margin: 1rem 0 0 0; font-size: 0.95rem; font-style: italic;">
                        Optional columns: Well Name, Rig Name, Project, Status, Risk, Comments, Location, and more...
                    </p>
                </div>
            </div>
        </div>
        """, unsafe_allow_html=True)


def generate_chart(csv_file_path, customization=None):
    """Generate timeline chart from uploaded CSV file with optional customization"""
    try:
        # Enhanced progress section
        st.markdown("""
        <div class="custom-card">
            <div class="card-header">
                ⚡ Generating Your Professional Chart
            </div>
            <p style="color: #6c757d; margin-bottom: 1rem;">
                Please wait while we process your data and create your interactive timeline...
            </p>
        </div>
        """, unsafe_allow_html=True)
        
        # Show progress with enhanced styling
        progress_bar = st.progress(0)
        status_text = st.empty()
        
        # Step 1: Process and validate data
        status_text.markdown("**⚙️ Step 1/5:** Processing and validating your data...")
        progress_bar.progress(20)
        
        data_processor = DataProcessor()
        processed_df = data_processor.load_and_prepare_data(csv_file_path)
        
        # Step 2: Setup color management
        status_text.markdown("**🎨 Step 2/5:** Setting up color management and themes...")
        progress_bar.progress(40)
        
        # Get path to chart colors file
        current_dir = os.path.dirname(os.path.abspath(__file__))
        chart_colors_path = os.path.join(current_dir, "assets", "chart_colors.json")
        
        color_manager = ColorManager(chart_colors_path)
        
        # Step 3: Generate chart
        status_text.markdown("**📊 Step 3/5:** Generating interactive timeline chart...")
        progress_bar.progress(60)
        
        chart_generator = ChartGenerator(color_manager)
        # Pass custom chart title if provided
        chart_title = customization.get('chart_title') if customization else None
        fig = chart_generator.create_drilling_sequence_chart(processed_df, chart_title=chart_title)
        
        # Step 4: Export to HTML
        status_text.markdown("**💾 Step 4/5:** Exporting chart with KPI dashboards...")
        progress_bar.progress(80)
        
        output_dir = tempfile.mkdtemp()
        # Pass customization parameters to exporter
        ChartExporter.export_chart(fig, output_dir, processed_df, color_manager, customization=customization)
        
        # Step 5: Finalizing
        status_text.markdown("**✅ Step 5/5:** Finalizing your professional chart...")
        progress_bar.progress(100)
        
        # Clear progress indicators
        progress_bar.empty()
        status_text.empty()
        
        # Display enhanced success message
        st.markdown("""
        <div class="custom-card" style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); border-color: #c3e6cb;">
            <div style="text-align: center; padding: 2rem;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">🎉</div>
                <h2 style="color: #155724; margin-bottom: 1rem; font-size: 2.2rem;">Chart Generated Successfully!</h2>
                <p style="color: #155724; margin: 0; font-size: 1.1rem;">Your professional interactive timeline chart is ready for download and sharing</p>
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        # Show enhanced chart info
        st.markdown("##### 📊 Chart Summary & Analytics")
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            # Check for various item/well columns
            item_col = None
            for col in ['Well Name', 'Item Name', 'Task Name', 'Project Name', 'Name']:
                if col in processed_df.columns:
                    item_col = col
                    break
            
            if item_col:
                total_items = processed_df[item_col].nunique()
                item_label = "Total Wells" if item_col == 'Well Name' else f"Total {item_col.replace(' Name', 's')}"
                st.metric(item_label, f"{total_items:,}", delta=None)
            else:
                total_items = len(processed_df)
                st.metric("Total Items", f"{total_items:,}", delta=None)
        
        with col2:
            total_activities = len(processed_df)
            st.metric("Total Activities", f"{total_activities:,}", delta=None)
        
        with col3:
            unique_activities = processed_df['Activity Type'].nunique()
            st.metric("Activity Types", unique_activities, delta=None)
        
        with col4:
            date_range_days = (processed_df['End Date'].max() - processed_df['Start Date'].min()).days
            date_range = f"{processed_df['Start Date'].min().strftime('%Y-%m-%d')} to {processed_df['End Date'].max().strftime('%Y-%m-%d')}"
            st.metric("Date Range", f"{date_range_days:,} days", delta=date_range)
        
        # Provide enhanced download section
        st.markdown("---")
        st.markdown("##### 📥 Download Your Chart")
        
        html_file_path = os.path.join(output_dir, "drilling_sequence.html")
        
        if os.path.exists(html_file_path):
            with open(html_file_path, 'rb') as file:
                html_content = file.read()
            
            col1, col2, col3 = st.columns([1, 2, 1])
            with col2:
                st.download_button(
                    label="📥 Download Interactive Chart (HTML)",
                    data=html_content,
                    file_name="drilling_sequence_chart.html",
                    mime="text/html",
                    type="primary",
                    use_container_width=True,
                    help="Download the complete interactive chart with KPI dashboards, signatures, and responsive design"
                )
            
            st.info("💡 **Tip:** The downloaded HTML file includes interactive features, KPI dashboards, and is optimized for both web viewing and printing.")
        
    except Exception as e:
        st.error(f"❌ Error generating chart: {str(e)}")
        st.error("Please check your CSV file format and try again.")
        
        # Show expected format
        with st.expander("📋 Expected CSV Format & Troubleshooting"):
            st.markdown("""
            ### Required Columns:
            - **Start Date**: Date in YYYY-MM-DD format
            - **End Date**: Date in YYYY-MM-DD format  
            - **Activity Type**: Type of drilling activity
            
            ### Optional Columns (enhance your chart):
            - **Well Name**: Name of the well
            - **Rig Name**: Name of the drilling rig
            - **Location**: Location of the drilling activity
            - **Project**: Project name or identifier
            - **Status**: Current status
            - **Risk**: Risk level or assessment
            - **Comments**: Additional notes
            - **Plan Type**: Type of plan
            - **Readiness Check**: Readiness information
            
            ### Common Issues:
            1. **Date Format**: Ensure dates are in YYYY-MM-DD format
            2. **Missing Columns**: Check that required columns exist
            3. **Empty Rows**: Remove any completely empty rows
            4. **Special Characters**: Avoid special characters in column names
            """)

if __name__ == "__main__":
    main()
