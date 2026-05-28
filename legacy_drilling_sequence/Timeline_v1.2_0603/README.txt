# Timeline Chart Generator - Portable Edition v1.2

## 🚀 Quick Start (Under 5 Minutes!)

### Step 1: One-Time Setup
1. **Download Anaconda (Recommended)**:
   - Go to: https://www.anaconda.com/download
   - Download: **Anaconda Individual Edition** (FREE)
   - Size: ~500MB download (includes many useful packages)
   - **Corporate Safe**: Widely approved by IT departments

   **Alternative - Miniconda (Smaller)**:
   - Go to: https://docs.conda.io/en/latest/miniconda.html
   - Download: **Miniconda** (Python 3.9+)
   - Size: ~50MB download (minimal installation)

2. **Install Anaconda/Miniconda**:
   - Run the downloaded installer
   - Choose "Just Me" (no admin rights required)
   - **Important**: Install to **this same folder** (where you see this README)
   - You should see an "Anaconda" or "miniconda3" folder created

3. **Complete Setup**:
   - Double-click `SETUP.bat`
   - Follow the prompts (automatic dependency installation)

### Step 2: Run the Application
1. **Start the App**: Double-click `START_APP.bat`
2. **Wait for Browser**: Takes 10-30 seconds to load first time
3. **Upload Data**: Use your CSV file or try `sample_data.csv`
4. **Generate Charts**: Create professional timeline visualizations!

## 📁 What's Included

```
Timeline_v1.2_0603/
├── 🚀 START_APP.bat           ← Click this to run
├── ⚙️ SETUP.bat               ← Run once for setup  
├── 📖 README.txt              ← This guide
├── 📊 sample_data.csv         ← Test data
├── 📄 app.py                  ← Main application
├── 📁 chart/                  ← Core components (renamed for shorter paths)
├── 📁 assets/                 ← Configurations
└── 📁 Anaconda/               ← Portable Python (after setup)
     or miniconda3/
```

## ✨ Key Features & Benefits

### 🎯 Corporate Environment Friendly
- ✅ **No Admin Rights Required**: Runs from any folder
- ✅ **No System Installation**: Everything is self-contained
- ✅ **Firewall Friendly**: No external connections after setup
- ✅ **Virus Scanner Safe**: Standard Python packages, no executables

### 📊 Complete Plotly Functionality
- ✅ **Interactive Charts**: Zoom, pan, hover, click
- ✅ **Professional Export**: High-quality HTML and PDF output
- ✅ **Responsive Design**: Works on different screen sizes
- ✅ **Real-time Updates**: Instant chart regeneration
- ✅ **Custom Styling**: Professional themes and colors

### 💼 Business Features
- ✅ **KPI Dashboards**: Automatic project metrics
- ✅ **Multi-format Export**: HTML, PDF via browser print
- ✅ **Document Control**: Version tracking and signatures
- ✅ **Data Validation**: Automatic error checking
- ✅ **Template Support**: Reusable chart configurations

## 📋 CSV Data Format

Your CSV file should include these columns:

### Required Columns:
- **Activity Type**: Description of the activity
- **Start Date**: Format: YYYY-MM-DD (e.g., 2024-01-15)
- **End Date**: Format: YYYY-MM-DD (e.g., 2024-03-20)

### Optional Columns (for enhanced features):
- **Project Name**: Groups activities by project
- **Well Name**: For drilling/oil industry projects
- **Rig Name**: Equipment assignments
- **Status**: Activity status for color coding
- **Priority**: High/Medium/Low for visual emphasis

### Example Data:
```csv
Activity Type,Start Date,End Date,Project Name,Status
Site Preparation,2024-01-01,2024-01-15,Project Alpha,Completed
Drilling Phase 1,2024-01-16,2024-02-28,Project Alpha,In Progress
Equipment Install,2024-03-01,2024-03-15,Project Alpha,Planned
```

## 🔧 Troubleshooting

### Setup Issues:
**Problem**: SETUP.bat fails or shows errors
- **Solution**: Ensure you downloaded Anaconda Individual Edition (free)
- **Check**: Anaconda or miniconda3 folder exists in the same directory as SETUP.bat
- **Try**: Run as administrator if on locked-down corporate systems

**Problem**: "Python not found" error
- **Solution**: Re-run SETUP.bat - it will guide you through the process
- **Alternative**: Download Anaconda again and install to this folder

### Application Issues:
**Problem**: Browser doesn't open automatically
- **Solution**: Manually open browser and go to: http://localhost:8501
- **Note**: The app runs locally - no internet data sharing

**Problem**: CSV upload fails
- **Solution**: Check your CSV format matches the examples above
- **Try**: Use the included sample_data.csv first

**Problem**: Charts don't display
- **Solution**: This is very rare - refresh the browser page
- **Check**: Look for error messages in the command window

### Performance Issues:
**Problem**: Slow startup
- **Normal**: First startup takes 30-60 seconds
- **Subsequent**: Should start in 10-20 seconds
- **Tip**: Keep the command window open between uses

## 🎨 Advanced Features

### Chart Customization:
- Custom titles and subtitles
- Company branding options
- Color scheme selection
- Legend positioning
- Print optimization

### Export Options:
- **HTML Export**: Interactive charts for sharing
- **PDF Export**: Print-ready documents via browser
- **Data Export**: Processed data downloads
- **Image Export**: PNG/SVG for presentations

### Data Analysis:
- Automatic timeline calculations
- Resource conflict detection
- Progress tracking
- Critical path highlighting

## 🔒 Security & Privacy

- **Local Operation**: All processing happens on your computer
- **No Data Upload**: No information sent to external servers
- **Corporate Safe**: Meets typical corporate security requirements
- **Offline Capable**: No internet required after initial setup

## 📞 Support

If you encounter issues:
1. Check the troubleshooting section above
2. Try the sample data first to isolate the problem
3. Look for error messages in the command window
4. Contact the person who provided this application

## 📈 Tips for Best Results

1. **Data Preparation**: Clean your CSV data before upload
2. **Date Formats**: Use YYYY-MM-DD format consistently
3. **Browser Choice**: Chrome/Edge work best for PDF export
4. **Screen Size**: Use landscape orientation on smaller screens
5. **Print Setup**: Use browser's "Print to PDF" for best results

---

**Version**: Portable v1.2 (Anaconda Edition)  
**Created**: Automatically generated  
**Compatibility**: Windows 7+ (64-bit recommended)  
**Python Version**: 3.9+ (via Anaconda/Miniconda)  
**Dependencies**: Streamlit, Pandas, Plotly (auto-installed via conda/pip)
