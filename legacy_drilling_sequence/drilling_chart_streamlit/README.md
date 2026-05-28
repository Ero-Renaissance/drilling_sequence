# Timeline Chart Generator

A comprehensive Streamlit application for generating interactive timeline Gantt charts from CSV data. Originally designed for drilling operations but now supports any timeline-based data visualization with advanced features including responsive design, KPI dashboards, and print-friendly exports.

## ✨ Key Features

### Interactive Timeline Visualization
- **Interactive Gantt Charts**: Generate beautiful timeline charts with custom colors and patterns
- **Time Navigation**: Interactive sliders for exploring different time periods
- **Zoom and Pan**: Full chart exploration capabilities with smooth interactions
- **Smart Auto-Detection**: Automatically adapts interface and terminology based on your data

### Responsive Design & Export
- **Multi-Device Support**: Charts work seamlessly on desktop, tablet, and mobile devices
- **Adaptive Layouts**: Viewport-specific optimizations with responsive margins and styling
- **Rich Export Options**: Export as interactive HTML with embedded KPI dashboards
- **Print-Friendly PDF**: Optimized for PDF export via browser printing with color preservation

### Advanced Dashboard Features
- **KPI Dashboard**: Automatically calculated metrics with color-coded status indicators
- **Adaptive Metrics**: Labels and calculations adjust based on data type (wells vs. items, rigs vs. resources)
- **Status Tracking**: Visual indicators for project status, risks, and readiness checks
- **Contract Management**: Alerts for expiring contracts and critical timelines

### Customization & Configuration
- **Flexible Title System**: Comprehensive title customization with auto-generation
- **Signature System**: Document control with customizable signatory roles
- **Color Management**: Consistent activity type colors across sessions
- **Icon Positioning**: Status indicators with multiple readiness check types

## 🚀 Quick Start

### Option 1: Portable Distribution (Recommended for Sharing)

**For sharing with colleagues who don't have Python installed:**

1. **Create Portable Version**:
   ```bash
   python create_portable_fixed.py
   ```

2. **Follow Setup Guide**: See [`PORTABLE_SETUP_GUIDE.md`](PORTABLE_SETUP_GUIDE.md) for detailed instructions

3. **Share the Generated Folder**: Recipients just need to run `START_APP.bat` - no installation required!

### Option 2: Development Installation

**For developers or users with Python already installed:**

1. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Application**:
   ```bash
   streamlit run app.py
   ```
   Or use the batch file on Windows:
   ```bash
   start_app.bat
   ```

### Basic Usage
1. **Upload Your Data**: Use the file uploader to upload a CSV with your timeline data
2. **Customize**: Configure titles, document settings, and signatory roles
3. **Generate**: Click "Generate Chart" to create your interactive timeline
4. **Export**: Download the generated HTML file with embedded dashboard

## 📊 Data Requirements

### Mandatory Columns
Your CSV file must contain these three columns:
- `Activity Type`: Type of activity or task
- `Start Date`: Start date (YYYY-MM-DD format)
- `End Date`: End date (YYYY-MM-DD format)

### Optional Columns (Auto-generated if missing)
- `Well Name`: Item identifier (defaults to "Item 1", "Item 2", etc.)
- `Rig Name`: Resource/group identifier (defaults to "Default Rig")
- `Project`: Project grouping (defaults to "Default Project")
- `Readiness Check Status`: Status indicators (defaults to "Not Specified")
- `Risk`: Risk information
- `Comment`: Additional notes
- `Rig Contract Expiry Date`: Contract expiration dates

### Example Data Format
```csv
Activity Type,Start Date,End Date,Well Name,Rig Name,Project,Readiness Check Status,Risk,Comment
Drilling,2024-01-15,2024-02-15,Well-001,Rig-A,Project Alpha,Plan on track,Low,Initial drilling phase
Completion,2024-02-16,2024-03-15,Well-001,Rig-A,Project Alpha,Completed,Low,Completion activities
Drilling,2024-02-01,2024-03-01,Well-002,Rig-B,Project Beta,Behind Schedule,High,Weather delays
```

## 🎛️ Configuration Options

### Title Configuration
The application supports comprehensive title customization:

#### In the UI:
- **Chart Title**: Title that appears at the top of the Plotly chart
- **Dashboard Header Title**: Main title in the exported HTML dashboard
- **Dashboard Subtitle**: Descriptive subtitle in the HTML dashboard
- **Document Title**: Title used in signatures and document control
- **Document Revision**: Version control for document management

#### Auto-Generation:
When titles are left blank, the system automatically generates appropriate titles based on your data:

- **Drilling data** (has Well Name + Rig Name): "🛢️ Drilling Operations Schedule Dashboard"
- **Project data** (multiple projects): "📊 Project Timeline & Schedule Dashboard"  
- **General timeline**: "📈 Timeline & Schedule Dashboard"

#### Programmatic Usage:
```python
from drilling_chart import ChartGenerator, ChartExporter, ColorManager

# Configure custom titles
customization = {
    'chart_title': 'My Custom Chart Title',
    'dashboard_title': '🚀 My Project Dashboard',
    'dashboard_subtitle': 'Comprehensive view of project activities',
    'html_document_title': 'Project Timeline Report',
    'document_title': 'Project Schedule',
    'document_revision': 'Rev. 02',
    'signatory_roles': ['Manager', 'Technical Lead', 'Operations']
}

# Generate and export
color_manager = ColorManager("assets/chart_colors.json")
chart_generator = ChartGenerator(color_manager)
fig = chart_generator.create_drilling_sequence_chart(df, chart_title=customization.get('chart_title'))
ChartExporter.export_chart(fig, output_dir, df, color_manager, customization=customization)
```

### Signature Configuration
- **Customizable Roles**: Define multiple signatory roles for document approval
- **Document Control**: Automatic date generation and revision tracking
- **Professional Layout**: Print-friendly signature section with proper spacing

## 📈 Output Features

### Interactive HTML Export
The exported HTML includes:
- **Interactive Gantt Chart**: Zoom, pan, and explore your timeline
- **Sticky KPI Dashboard**: Real-time metrics that stay visible while scrolling
- **Comprehensive Legend**: Color-coded activity types and status indicators with adaptive content
- **Signature Section**: Professional document control and approval section
- **Responsive Design**: Optimized viewing on all device types

### KPI Dashboard Metrics
Automatically calculated and displayed:
- **Total Items/Wells**: Count based on data type
- **Active Resources/Rigs**: Unique resource count
- **Project Groups**: Number of distinct projects
- **Critical Issues**: Items behind schedule or with critical status
- **Contract Alerts**: Expiring contracts and deadlines
- **Risk Indicators**: Color-coded status based on risk levels

### Print & PDF Export
- **Color Preservation**: All colors and styling preserved in PDF export
- **Optimized Layout**: Clean formatting for professional documents
- **Browser Compatible**: Works with all modern browsers' print-to-PDF functionality

## 🔧 Advanced Features

### Responsive Design System
- **Viewport Detection**: Automatic adaptation to screen size and orientation
- **Dynamic Margins**: Responsive spacing and layout adjustments
- **Mobile Optimization**: Touch-friendly interactions and compressed layouts
- **Label Management**: Intelligent month label display based on screen size

### Icon & Status System
- **Readiness Indicators**: Visual status icons with positioning algorithms
- **Status Categories**: Multiple status types with color coding
- **Adaptive Display**: Icons appear only when meaningful data exists

### Legend System
- **Interactive Controls**: Collapse/expand functionality with size controls
- **Adaptive Content**: Legend sections appear based on available data
- **Multiple Sections**: Activity Types, Milestones, Status Colors, Plan Types, Expiry Warnings
- **Responsive Sizing**: Automatic adjustment for different screen sizes

### Time Navigation
- **Interactive Sliders**: Smooth time period navigation
- **Monthly Visualization**: Alternating background bands for easy month identification
- **Responsive Labels**: Adaptive month labeling based on viewport size

## 🔄 System Adaptability

The system intelligently adapts to your data:

### Terminology Adaptation
- **Labels**: "Total Wells" vs "Total Items" based on column presence
- **Resources**: "Active Rigs" vs "Resources" depending on data type
- **Groups**: "Projects" vs "Groups" based on project data

### Feature Adaptation
- **Status Icons**: Only appear when meaningful status data exists
- **Contract Alerts**: Displayed only when contract expiry data is available
- **Risk Indicators**: Show when risk information is provided
- **Project Grouping**: Activated when multiple projects are detected

### Color Management
- **Consistent Colors**: Activity types get consistent colors across sessions
- **Dynamic Assignment**: Automatic color assignment for new activity types
- **Customizable Palette**: JSON-based color configuration system

## 🌐 Browser Compatibility

### Full Feature Support
- **Chrome/Edge**: Complete functionality including all interactive features
- **Firefox**: Full feature support with optimized performance
- **Safari**: Complete compatibility with responsive design
- **Mobile Browsers**: Touch-optimized interactions and layouts

### Print to PDF Support
- **All Browsers**: Universal print-to-PDF compatibility
- **Color Preservation**: Background colors and styling maintained
- **Layout Optimization**: Professional document formatting

## 🏗️ Architecture

### Modular Package Structure
```
drilling_chart/
├── core/
│   ├── color_manager.py       # Color management and configuration
│   ├── data_processor.py      # Data validation and processing
│   └── chart_generator.py     # Main chart generation with responsive design
├── visualization/
│   ├── icon_positioner.py     # Status icon positioning algorithms
│   ├── legend_generator.py    # Adaptive legend generation
│   └── signature_generator.py # Document signature system
└── export/
    └── chart_exporter.py      # HTML export with KPI dashboards
```

### Core Components
- **ColorManager**: Dynamic color assignment and persistence
- **DataProcessor**: Data validation, cleaning, and preparation
- **ChartGenerator**: Interactive Gantt chart creation with responsive features
- **IconPositioner**: Intelligent positioning of status indicators
- **LegendGenerator**: Adaptive legend with interactive controls
- **ChartExporter**: Comprehensive HTML export with embedded features

## 🛠️ Development & API

### Package Installation
```python
# Install the package in development mode
pip install -e .

# Import core components
from drilling_chart import (
    ColorManager, 
    DataProcessor, 
    ChartGenerator, 
    ChartExporter
)
```

### Basic API Usage
```python
import pandas as pd
from drilling_chart import ChartGenerator, ChartExporter, ColorManager, DataProcessor

# Load and process data
processor = DataProcessor()
df = processor.load_csv("data.csv")
processed_data = processor.prepare_data(df)

# Initialize components
color_manager = ColorManager("assets/chart_colors.json")
chart_generator = ChartGenerator(color_manager)

# Generate chart
fig = chart_generator.create_drilling_sequence_chart(
    processed_data, 
    chart_title="My Project Timeline"
)

# Export with customization
customization = {
    'dashboard_title': 'Project Dashboard',
    'dashboard_subtitle': 'Comprehensive project overview',
    'signatory_roles': ['Project Manager', 'Technical Lead']
}

ChartExporter.export_chart(fig, "output/", df, color_manager, customization)
```

## 📦 Distribution & Deployment

### Portable Distribution (Recommended)

The **portable distribution method** is the best way to share this application with colleagues who don't have Python installed. 

#### Key Benefits:
- ✅ **No Python Required**: Recipients don't need Python, Miniconda, or any development tools
- ✅ **One-Click Run**: Just double-click `START_APP.bat` to start the application
- ✅ **Self-Contained**: Everything is included in a single folder
- ✅ **No Admin Rights**: No installation or admin privileges required

#### Quick Steps:
1. **Run**: `python create_portable_fixed.py`
2. **Follow**: [`PORTABLE_SETUP_GUIDE.md`](PORTABLE_SETUP_GUIDE.md) for detailed instructions
3. **Share**: ZIP the generated folder and send to colleagues
4. **Recipient**: Extract and run `START_APP.bat` - that's it!

#### Important Notes:
- **Path Requirements**: Setup folder must NOT contain spaces (avoid OneDrive folders with company names)
- **Python.exe Conflict**: Must remove any `python.exe` file from main folder after setup
- **File Size**: Portable version is ~300MB but includes everything needed

For complete step-by-step instructions, see [`PORTABLE_SETUP_GUIDE.md`](PORTABLE_SETUP_GUIDE.md).

## 🔍 Troubleshooting

### Common Issues
1. **Empty requirements.txt**: Use `pip install streamlit pandas plotly`
2. **Date Format Errors**: Ensure dates are in YYYY-MM-DD format
3. **Missing Columns**: Verify mandatory columns (Activity Type, Start Date, End Date) exist
4. **Color Issues in PDF**: Use browser's print-to-PDF feature, not print-to-printer
5. **Mobile Display**: Chart may require horizontal scrolling on very small screens

### Performance Optimization
- **Large Datasets**: Consider filtering data to essential time periods
- **Export Speed**: Complex charts may take a few seconds to generate
- **Browser Memory**: Close other tabs when working with large datasets

### Browser-Specific Notes
- **Safari**: Ensure JavaScript is enabled for full interactivity
- **Mobile Chrome**: Use landscape orientation for better chart visibility
- **Print Preview**: Colors may not show in print preview but will appear in final PDF

## 📞 Support

### Data Format Validation
Ensure your CSV file includes:
- Proper date formatting (YYYY-MM-DD)
- No missing values in mandatory columns
- Consistent activity type naming

### Feature Requests
The application is designed to be extensible. Future enhancements may include:
- Additional chart types
- Advanced filtering options
- Custom color theme management
- Enhanced mobile interactions

For technical issues, verify:
1. All dependencies are installed (`pip install -r requirements.txt`)
2. CSV file format matches requirements
3. Browser JavaScript is enabled
4. Sufficient system memory for large datasets

## 📄 License

This Timeline Chart Generator is designed for internal use and project management applications. The system adapts to various data types while maintaining professional output quality suitable for reports and presentations.