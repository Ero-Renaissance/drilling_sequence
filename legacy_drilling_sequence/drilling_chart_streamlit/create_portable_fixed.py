r"""
Timeline Chart Generator - Portable Distribution Creator
Fixed for Windows path length issues and optimized for corporate deployment.

CRITICAL REQUIREMENTS:
======================
1. SETUP FOLDER PATH MUST NOT CONTAIN SPACES
   ✅ Good: C:\Users\Name\Documents\Timeline_v1.2_0603\
   ❌ Bad:  C:\Users\Name\OneDrive - Company\Documents\...
   
2. AFTER MINICONDA INSTALLATION: Remove python.exe from main folder
   - Miniconda creates a stub python.exe in main folder
   - This MUST be deleted to avoid "python313.dll not found" errors
   - Command: Remove-Item "python.exe" -Force
   - Keep only: miniconda3\python.exe
   
3. MINICONDA INSTALLER INCLUDED
   - File: Miniconda3-latest-Windows-x86_64.exe
   - No download needed - everything included
   - Corporate-safe standard Python distribution

USAGE:
======
1. python create_portable_fixed.py
2. Choose destination path WITHOUT SPACES
3. After setup: Remove python.exe from main folder
4. Distribute the generated folder to colleagues
"""

import os
import shutil
import stat
import zipfile
from pathlib import Path
import datetime


def create_portable_timeline_generator():
    """Create a complete portable distribution package with short paths"""
    
    print("🚀 Creating Portable Timeline Chart Generator")
    print("=" * 60)
    
    # Use very short names to avoid Windows path length limits
    timestamp = datetime.datetime.now().strftime("%m%d")
    package_name = f"Timeline_v1.2_{timestamp}"
    
    # Create distribution directory
    dist_dir = Path(package_name)
    if dist_dir.exists():
        print(f"🗑️  Removing existing package: {dist_dir}")
        try:
            # Handle Windows file locking and read-only attributes
            for root, dirs, files in os.walk(dist_dir):
                for file in files:
                    file_path = os.path.join(root, file)
                    try:
                        os.chmod(file_path, stat.S_IWRITE)
                    except:
                        pass
            shutil.rmtree(dist_dir)
        except (PermissionError, OSError) as e:
            print(f"⚠️  Warning: Could not remove existing directory: {e}")
            # Use unique name to avoid conflicts
            counter = 1
            while dist_dir.exists():
                new_name = f"{package_name}_{counter}"
                dist_dir = Path(new_name)
                counter += 1
            print(f"📁 Using directory name: {dist_dir}")
    
    dist_dir.mkdir()
    print(f"📁 Creating package in: {dist_dir}")
      # Copy application files including Miniconda installer
    print("\n📋 Copying application files...")
    files_to_copy = [
        ('app.py', 'Main Streamlit application'),
        ('requirements.txt', 'Python dependencies'), 
        ('drilling_chart/', 'Application package'),
        ('assets/', 'Chart configurations'),
        ('README.md', 'Documentation'),
        ('PORTABLE_SETUP_GUIDE.txt', 'Complete setup instructions'),
        ('Miniconda3-latest-Windows-x86_64.exe', 'Miniconda installer (no download needed)')
    ]
    
    for item, description in files_to_copy:
        src = Path(item)
        if src.exists():
            try:
                if src.is_dir():
                    # Use shorter destination name for dirs to avoid path limits
                    dest_name = 'drilling_chart' if item == 'drilling_chart/' else src.name
                    shutil.copytree(src, dist_dir / dest_name, dirs_exist_ok=True)
                    print(f"  ✅ Copied folder: {item} → {dest_name} ({description})")
                else:
                    shutil.copy2(src, dist_dir)
                    print(f"  ✅ Copied file: {item} ({description})")
            except Exception as e:
                print(f"  ❌ Error copying {item}: {e}")
        else:
            print(f"  ⚠️  Missing: {item} - {description}")
      # Create all the necessary scripts and documentation
    print("\n🔧 Creating setup and launch scripts...")
    create_startup_script(dist_dir)
    create_setup_script(dist_dir)
    create_colleague_readme(dist_dir)
    create_sample_csv(dist_dir)
    create_troubleshooting_guide(dist_dir)
    create_installation_helper(dist_dir)
    create_path_verification_script(dist_dir)
    
    # Create ZIP file for easy distribution
    zip_success = create_distribution_zip(dist_dir.name)
    
    print(f"\n🎉 Portable package created successfully!")
    print(f"📦 Package folder: {dist_dir.name}")
    
    if zip_success:
        print(f"📤 Distribution ZIP: {dist_dir.name}.zip")
        print("\n📋 Next steps:")
        print("  1. Send the ZIP file to your colleague")
        print("  2. They extract it and run SETUP.bat once")
        print("  3. They use START_APP.bat to run the app")
    else:
        print("⚠️  ZIP file creation had issues, but package folder is complete")
        print("\n📋 Alternative distribution:")
        print("  1. Copy the entire package folder to your colleague")
        print("  2. They run SETUP.bat once")
        print("  3. They use START_APP.bat to run the app")
    
    return True


def create_startup_script(dist_dir):
    """Create an enhanced startup script with shorter name"""
    
    startup_script = r'''@echo off
title Timeline Chart Generator
color 0B

echo ==========================================
echo   🚀 Timeline Chart Generator v1.2
echo ==========================================
echo.

REM Check if Python is available
set PYTHON_CMD=
if exist "python.exe" (
    set PYTHON_CMD=python.exe
    echo ✅ Using portable Python environment
    goto :check_dependencies
)

if exist "Anaconda\\python.exe" (
    set PYTHON_CMD=Anaconda\\python.exe
    echo ✅ Using Anaconda installation
    goto :check_dependencies
)

if exist "Anaconda\\Scripts\\python.exe" (
    set PYTHON_CMD=Anaconda\\Scripts\\python.exe
    echo ✅ Using Anaconda Scripts directory
    goto :check_dependencies
)

if exist "miniconda3\\python.exe" (
    set PYTHON_CMD=miniconda3\\python.exe
    echo ✅ Using Miniconda installation
    goto :check_dependencies
)

if exist "miniconda3\\Scripts\\python.exe" (
    set PYTHON_CMD=miniconda3\\Scripts\\python.exe
    echo ✅ Using Miniconda Scripts directory
    goto :check_dependencies
)

REM Try system Python as fallback
python --version >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=python
    echo ✅ Using system Python
    goto :check_dependencies
)

echo ❌ Python environment not found!
echo.
echo 📋 Please run SETUP.bat first to install Anaconda
echo    Or ensure you have Python installed on your system
echo.
pause
exit /b 1

:check_dependencies
echo 📦 Checking/installing dependencies...
%PYTHON_CMD% -m pip install --quiet --upgrade streamlit>=1.28.0 pandas>=1.5.0 plotly>=5.15.0

if %errorlevel% neq 0 (
    echo ⚠️  Warning: Could not install some dependencies
    echo    The application may still work with existing packages
    echo.
)

:run_app
echo.
echo 🌐 Starting Timeline Chart Generator...
echo ⏳ Please wait while the application loads (10-30 seconds)...
echo.
echo 📊 Your browser will open automatically when ready
echo 🌍 Application URL: http://localhost:8501
echo.
echo 💡 Tips:
echo    • Upload a CSV file with timeline data
echo    • Use the sample_data.csv for testing
echo    • Generate professional charts and export as HTML/PDF
echo.
echo 🛑 To stop: Close this window or press Ctrl+C
echo ==========================================
echo.

REM Start the Streamlit application
%PYTHON_CMD% -m streamlit run app.py --server.headless true --server.port 8501

echo.
echo 👋 Timeline Chart Generator stopped.
pause
'''
    
    # Use shorter filename
    with open(dist_dir / 'START_APP.bat', 'w', encoding='utf-8') as f:
        f.write(startup_script)
    
    print("  ✅ Created startup script (START_APP.bat)")


def create_setup_script(dist_dir):
    """Create a comprehensive setup script"""
    
    setup_script = r'''@echo off
title Timeline Chart Generator - Setup
color 0A

echo ==========================================
echo   Timeline Chart Generator - Setup v1.2
echo ==========================================
echo.

REM Check if already set up
if exist "python.exe" (
    echo ✅ Portable Python already configured!
    echo 🚀 You can now run START_APP.bat
    echo.
    pause
    exit /b 0
)

echo 📋 Automatic Setup Process:
echo.
echo This setup will guide you through installing a portable
echo Python environment that doesn't require administrator rights.
echo.

REM Check for existing Anaconda installation
if exist "Anaconda\\python.exe" (
    echo ✅ Anaconda installation detected!
    goto :configure_environment
)

if exist "Anaconda\\Scripts\\python.exe" (
    echo ✅ Anaconda installation detected!
    goto :configure_environment
)

if exist "miniconda3\\python.exe" (
    echo ✅ Miniconda installation detected!
    goto :configure_environment
)

if exist "miniconda3\\Scripts\\python.exe" (
    echo ✅ Miniconda installation detected!
    goto :configure_environment
)

echo 📥 Miniconda Installation (Installer Included):
echo.
echo ✅ Good news! Miniconda installer is already included in this package.
echo    No download required - everything you need is here!
echo.
echo 🔧 AUTOMATIC INSTALLATION:
echo ========================
set /p auto_install="Install Miniconda automatically? (y/n): "
if /i "%auto_install%"=="y" goto :auto_install

echo.
echo 🛠️ MANUAL INSTALLATION:
echo ========================
echo 1. Look for "Miniconda3-latest-Windows-x86_64.exe" in this folder
echo 2. Double-click it to run the installer
echo 3. IMPORTANT: Choose these settings:
echo    ✓ Installation Type: "Just Me (recommended)"
echo    ✓ Destination Folder: %CD%\miniconda3
echo    ✓ Advanced Options: Uncheck "Add to PATH" (optional)
echo.
echo 💡 Copy this path for installation: %CD%\miniconda3
echo.
echo Press any key when installation is complete...
pause
goto :check_installation

:auto_install
echo.
echo 🚀 Starting automatic Miniconda installation...
echo    Installation path: %CD%\miniconda3
echo.
echo ⏳ This will take 2-5 minutes. Please wait...
echo.

REM Run silent installation with exact path
Miniconda3-latest-Windows-x86_64.exe /InstallationType=JustMe /RegisterPython=0 /S /D=%CD%\miniconda3

echo.
echo ✅ Installation completed!
echo.

:check_installation

REM Check again after user action
if exist "Anaconda\\python.exe" (
    goto :configure_environment
)

if exist "Anaconda\\Scripts\\python.exe" (
    goto :configure_environment
)

if exist "miniconda3\\python.exe" (
    goto :configure_environment
)

if exist "miniconda3\\Scripts\\python.exe" (
    goto :configure_environment
)

echo ❌ Anaconda/Miniconda still not detected.
echo    Please ensure you installed to THIS folder.
echo    You should see an "Anaconda" or "miniconda3" folder created.
echo.
pause
exit /b 1

:configure_environment
echo.
echo 🔧 Configuring Python environment...

REM Determine the correct Python path
set PYTHON_EXE=
if exist "Anaconda\\python.exe" (
    set PYTHON_EXE=Anaconda\\python.exe
    set CONDA_EXE=Anaconda\\Scripts\\conda.exe
) else if exist "Anaconda\\Scripts\\python.exe" (
    set PYTHON_EXE=Anaconda\\Scripts\\python.exe
    set CONDA_EXE=Anaconda\\Scripts\\conda.exe
) else if exist "miniconda3\\python.exe" (
    set PYTHON_EXE=miniconda3\\python.exe
    set CONDA_EXE=miniconda3\\Scripts\\conda.exe
) else if exist "miniconda3\\Scripts\\python.exe" (
    set PYTHON_EXE=miniconda3\\Scripts\\python.exe
    set CONDA_EXE=miniconda3\\Scripts\\conda.exe
)

REM Create convenient shortcut
if not exist "python.exe" (
    echo 🔗 Creating Python shortcut...
    mklink /H python.exe "%PYTHON_EXE%" >nul 2>&1
    if %errorlevel% equ 0 (
        echo   ✅ Python shortcut created
    ) else (
        echo   ⚠️  Could not create shortcut, but installation will still work
    )
)

REM Create conda shortcut if available
if not exist "conda.exe" (
    if exist "%CONDA_EXE%" (
        echo 🔗 Creating Conda shortcut...
        mklink /H conda.exe "%CONDA_EXE%" >nul 2>&1
        if %errorlevel% equ 0 (
            echo   ✅ Conda shortcut created
        )
    )
)

echo 📦 Installing Timeline Chart Generator dependencies...
echo    Using conda for better package management (2-3 minutes)...

REM Try conda first (preferred for Anaconda environments)
if exist "%CONDA_EXE%" (
    echo   🐍 Installing with conda...
    %CONDA_EXE% install -y streamlit pandas plotly --quiet
    if %errorlevel% equ 0 (
        echo   ✅ Conda installation successful
        goto :test_installation
    ) else (
        echo   ⚠️  Conda installation had issues, trying pip...
    )
)

REM Fallback to pip
echo   📦 Installing with pip...
%PYTHON_EXE% -m pip install --upgrade pip --quiet
%PYTHON_EXE% -m pip install streamlit>=1.28.0 --quiet
%PYTHON_EXE% -m pip install pandas>=1.5.0 --quiet  
%PYTHON_EXE% -m pip install plotly>=5.15.0 --quiet

:test_installation
if %errorlevel% equ 0 (
    echo   ✅ All dependencies installed successfully
) else (
    echo   ⚠️  Some dependencies may not have installed correctly
    echo      The application may still work
)

echo.
echo 🧪 Testing installation...
%PYTHON_EXE% -c "import streamlit, pandas, plotly; print('✅ All core packages imported successfully')"

if %errorlevel% equ 0 (
    echo.
    echo 🎉 Setup Complete!
    echo ==========================================
    echo.
    echo 🚀 Next Steps:
    echo   1. Double-click START_APP.bat
    echo   2. Wait for your browser to open
    echo   3. Upload a CSV file or use the sample data
    echo   4. Generate your timeline charts!
    echo.
    echo 📁 Files you can use:
    echo   • START_APP.bat (main launcher)
    echo   • sample_data.csv (test data)
    echo   • README.txt (detailed instructions)
    echo.
) else (
    echo.
    echo ❌ Setup completed with warnings
    echo    Try running START_APP.bat anyway
    echo.
)

pause
'''
    
    with open(dist_dir / 'SETUP.bat', 'w', encoding='utf-8') as f:
        f.write(setup_script)
    
    print("  ✅ Created setup script (SETUP.bat)")


def create_colleague_readme(dist_dir):
    """Create user-friendly README for the colleague"""
    
    readme_content = r'''# Timeline Chart Generator - Portable Edition v1.2

## 🚀 Quick Start (Under 5 Minutes!)

### Step 1: One-Time Setup
1. **✅ MINICONDA INCLUDED - NO DOWNLOAD NEEDED!**:
   - The installer is already included in this package
   - File: `Miniconda3-latest-Windows-x86_64.exe`
   - No internet connection required for installation
   - **Corporate Safe**: Standard Python distribution

2. **Install Miniconda (Choose One Method)**:

   **🚀 AUTOMATIC (Recommended)**:
   - Double-click `SETUP.bat`
   - Choose "y" when asked about automatic installation
   - Wait 2-5 minutes for completion

   **🛠️ MANUAL**:
   - Double-click `Miniconda3-latest-Windows-x86_64.exe`
   - Choose "Just Me" (no admin rights required)
   - **IMPORTANT**: Use this exact path: `[current folder]\miniconda3`
   - Use `INSTALL_HELPER.bat` to get the exact path to copy/paste

3. **Complete Setup**:
   - Run `SETUP.bat` to install dependencies
   - Use `VERIFY_PATHS.bat` to check installation success

### Step 2: Run the Application
1. **Start the App**: Double-click `START_APP.bat`
2. **Wait for Browser**: Takes 10-30 seconds to load first time
3. **Upload Data**: Use your CSV file or try `sample_data.csv`
4. **Generate Charts**: Create professional timeline visualizations!

## 📁 What's Included

```
Timeline_v1.2_0603/
├── 🚀 START_APP.bat                    ← Click this to run
├── ⚙️ SETUP.bat                        ← Run once for setup  
├── 📖 README.txt                       ← This guide
├── 🛠️ INSTALL_HELPER.bat               ← Get installation path
├── 🔍 VERIFY_PATHS.bat                 ← Check installation
├── 🆘 HELP.txt                         ← Troubleshooting guide
├── 📊 sample_data.csv                  ← Test data
├── 📄 app.py                           ← Main application
├── 💿 Miniconda3-latest-Windows-x86_64.exe ← Python installer (included!)
├── 📁 drilling_chart/                  ← Core components
├── 📁 assets/                          ← Configurations
└── 📁 miniconda3/                      ← Portable Python (after setup)
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
'''
    
    with open(dist_dir / 'README.txt', 'w', encoding='utf-8') as f:
        f.write(readme_content)
    
    print("  ✅ Created user guide (README.txt)")


def create_sample_csv(dist_dir):
    """Create a sample CSV file for testing"""
    
    sample_data = '''Activity Type,Start Date,End Date,Project Name,Well Name,Rig Name,Status,Priority
Site Survey,2024-01-01,2024-01-10,Alpha Project,Well A-01,Rig 001,Completed,High
Permits & Approvals,2024-01-05,2024-01-25,Alpha Project,Well A-01,,In Progress,High
Access Road Construction,2024-01-20,2024-02-05,Alpha Project,Well A-01,,Planned,Medium
Drilling Preparation,2024-02-01,2024-02-10,Alpha Project,Well A-01,Rig 001,Planned,High
Spud & Surface Hole,2024-02-10,2024-02-20,Alpha Project,Well A-01,Rig 001,Planned,High
Intermediate Section,2024-02-20,2024-03-15,Alpha Project,Well A-01,Rig 001,Planned,High
Production Section,2024-03-15,2024-04-10,Alpha Project,Well A-01,Rig 001,Planned,Medium
Well Completion,2024-04-10,2024-04-25,Alpha Project,Well A-01,,Planned,Medium
Site Survey,2024-02-01,2024-02-08,Beta Project,Well B-01,Rig 002,Planned,Medium
Environmental Assessment,2024-01-15,2024-02-15,Beta Project,Well B-01,,In Progress,High
Equipment Mobilization,2024-02-20,2024-03-01,Beta Project,Well B-01,Rig 002,Planned,Medium
Drilling Operations,2024-03-01,2024-04-15,Beta Project,Well B-01,Rig 002,Planned,High
Testing & Evaluation,2024-04-15,2024-05-01,Beta Project,Well B-01,,Planned,Medium
Project Planning,2024-01-01,2024-01-31,Gamma Infrastructure,,,Completed,High
Design Phase,2024-02-01,2024-03-15,Gamma Infrastructure,,,In Progress,High
Construction Phase 1,2024-03-15,2024-05-31,Gamma Infrastructure,,,Planned,High
Construction Phase 2,2024-06-01,2024-08-15,Gamma Infrastructure,,,Planned,Medium
Commissioning,2024-08-15,2024-09-15,Gamma Infrastructure,,,Planned,Medium'''
    
    with open(dist_dir / 'sample_data.csv', 'w', encoding='utf-8') as f:
        f.write(sample_data)
    
    print("  ✅ Created sample CSV file (sample_data.csv)")


def create_troubleshooting_guide(dist_dir):
    """Create a detailed troubleshooting guide"""
    
    troubleshooting_content = '''# Timeline Chart Generator - Troubleshooting Guide

## 🚨 Common Issues & Solutions

### Setup Problems

#### Issue: "Anaconda/Miniconda not found" during setup
**Symptoms**: SETUP.bat cannot find Python installation
**Solutions**:
1. Ensure you downloaded Anaconda Individual Edition from https://www.anaconda.com/download
2. Install Anaconda to the SAME folder as SETUP.bat (choose "Just Me" option)
3. Look for an "Anaconda" or "miniconda3" folder after installation
4. If using Windows 11, try "Run as administrator"

#### Issue: SETUP.bat shows permission errors
**Symptoms**: Access denied or permission errors during setup
**Solutions**:
1. Right-click SETUP.bat → "Run as administrator"
2. Check Windows Defender isn't blocking the script
3. Temporarily disable antivirus during setup
4. Use Windows PowerShell: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

### Application Launch Problems

#### Issue: START_APP.bat doesn't work
**Symptoms**: Command window opens and closes immediately
**Solutions**:
1. Run SETUP.bat first (one-time requirement)
2. Check that python.exe exists in the folder
3. Try double-clicking the .bat file instead of right-clicking
4. Open Command Prompt and run: `START_APP.bat`

#### Issue: "Python command not found"
**Symptoms**: Error message about Python not being recognized
**Solutions**:
1. Re-run SETUP.bat - it will fix Python shortcuts
2. Check Anaconda or miniconda3 folder exists and contains python.exe
3. Manually run: `Anaconda\\python.exe -m streamlit run app.py`

### Browser & Application Issues

#### Issue: Browser doesn't open automatically
**Symptoms**: Command window shows "running" but no browser
**Solutions**:
1. Manually open your browser
2. Go to: http://localhost:8501
3. Wait 30-60 seconds for first-time loading
4. Check Windows Firewall isn't blocking local connections

#### Issue: "This site can't be reached" in browser
**Symptoms**: Browser shows connection error
**Solutions**:
1. Wait longer - first startup takes 30-60 seconds
2. Check the command window for error messages
3. Try a different browser (Chrome, Edge, Firefox)
4. Restart the application (close command window, run START_APP.bat again)

#### Issue: Application loads but shows errors
**Symptoms**: Streamlit interface appears but shows error messages
**Solutions**:
1. Check your CSV file format (see README for examples)
2. Try the sample_data.csv file first
3. Look for specific error messages in the web interface
4. Restart the application

### CSV Upload Problems

#### Issue: "File upload failed" or CSV errors
**Symptoms**: Cannot upload CSV or data processing errors
**Solutions**:
1. **Check CSV format**:
   - Required columns: Activity Type, Start Date, End Date
   - Date format: YYYY-MM-DD (e.g., 2024-01-15)
   - No empty rows at the beginning
   - UTF-8 encoding (save from Excel as "CSV UTF-8")

2. **Test with sample data**:
   - Use included sample_data.csv first
   - If sample works, your CSV format needs adjustment

3. **Common CSV fixes**:
   - Remove extra commas and quotes
   - Ensure dates are in YYYY-MM-DD format
   - Remove special characters from column headers
   - Save as plain CSV (not Excel format)

### Chart Display Problems

#### Issue: Charts don't appear or show as blank
**Symptoms**: Upload succeeds but no chart displays
**Solutions**:
1. **Refresh the browser page**
2. **Check data validity**:
   - At least one activity with valid start/end dates
   - Start date before end date
   - Dates within reasonable range (not too far in past/future)
3. **Try with sample data first**
4. **Look for error messages in red text on the webpage

#### Issue: Charts appear but look wrong
**Symptoms**: Charts display but formatting is incorrect
**Solutions**:
1. Check your data has the expected columns
2. Verify date formats are consistent
3. Try different chart title options
4. Use the customization options in the app interface

### Export Problems

#### Issue: HTML export doesn't work
**Symptoms**: Cannot download or generate HTML files
**Solutions**:
1. Click "Generate Chart" first
2. Wait for chart to fully load
3. Try right-clicking the download link → "Save link as"
4. Check browser's download settings/permissions

#### Issue: PDF export quality is poor
**Symptoms**: PDF looks different from screen display
**Solutions**:
1. **Use browser's Print to PDF**:
   - Ctrl+P (Windows) or Cmd+P (Mac)
   - Choose "Save as PDF" as destination
   - Select "More settings" → "Options" → "Background graphics"
2. **Optimize settings**:
   - Paper size: A4 or Letter
   - Margins: Minimum
   - Scale: Custom (try 80-90%)

### Performance Issues

#### Issue: Application runs slowly
**Symptoms**: Long delays when generating charts
**Solutions**:
1. **Normal behavior**: First startup is always slower (30-60 seconds)
2. **Large datasets**: Try with smaller CSV files first
3. **System resources**: Close other applications to free up memory
4. **Browser cache**: Clear browser cache and reload

#### Issue: Command window shows warnings
**Symptoms**: Yellow/orange warning messages
**Solutions**:
1. **Dependency warnings**: Usually safe to ignore
2. **Port warnings**: Try different port: `python -m streamlit run app.py --server.port 8502`
3. **Update warnings**: Run SETUP.bat again to update packages

## 🔧 Advanced Troubleshooting

### Manual Command Line Usage

If the batch files don't work, try these manual commands:

```cmd
# Navigate to application folder
cd "path\\to\\Timeline_v1.2_folder"

# Start with WinPython
WinPython\\python.exe -m streamlit run app.py

# Or if python.exe shortcut exists
python.exe -m streamlit run app.py

# Check package installation
python.exe -c "import streamlit, pandas, plotly; print('All packages OK')"

# Install missing packages manually
python.exe -m pip install streamlit pandas plotly
```

### Corporate Environment Issues

#### Issue: Cannot download WinPython
**Solutions**:
1. Download from personal device/network
2. Ask IT department to whitelist winpython.github.io
3. Use alternative: Download Anaconda Individual Edition (free)

#### Issue: Scripts blocked by security policy
**Solutions**:
1. Ask IT to temporarily allow script execution
2. Use PowerShell alternative (contact support for PowerShell scripts)
3. Run components manually via command line

#### Issue: Antivirus blocking application
**Solutions**:
1. Add application folder to antivirus exceptions
2. Use Windows Defender exclusions: Settings → Windows Security → Virus & threat protection → Exclusions
3. Temporarily disable real-time scanning during setup

### Still Need Help?

If none of these solutions work:

1. **Collect Information**:
   - Windows version (Win 10/11)
   - Error messages (exact text)
   - Steps that led to the problem
   - Whether sample data works

2. **Contact Support**:
   - Reach out to the person who provided this application
   - Include the information from step 1
   - Mention which troubleshooting steps you've tried

3. **Alternative Solutions**:
   - Try on a different computer
   - Use a different browser
   - Ask IT department for assistance with Python installation

---

**Remember**: Most issues are solved by re-running SETUP.bat or using the sample data first!
'''
    
    with open(dist_dir / 'HELP.txt', 'w', encoding='utf-8') as f:
        f.write(troubleshooting_content)
    
    print("  ✅ Created troubleshooting guide (HELP.txt)")


def create_distribution_zip(package_name):
    """Create a ZIP file for easy distribution with Windows-safe paths"""
    
    print(f"\n📦 Creating distribution ZIP file...")
    
    zip_filename = f"{package_name}.zip"
    package_dir = Path(package_name)
    
    try:
        with zipfile.ZipFile(zip_filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
            if not package_dir.exists():
                print(f"❌ Error: Package directory {package_name} not found!")
                return False
            
            print(f"  📁 Adding files from {package_dir}...")
            file_count = 0
            
            for file_path in package_dir.rglob('*'):
                if file_path.is_file():
                    # Use relative path from package directory to maintain structure
                    # but keep paths short to avoid Windows limits
                    arcname = file_path.relative_to(package_dir.parent)
                    
                    # Convert path to string and check length
                    arcname_str = str(arcname)
                    if len(arcname_str) < 200:  # Safe limit for ZIP paths
                        zipf.write(file_path, arcname)
                        file_count += 1
                        
                        if file_count % 50 == 0:
                            print(f"    📄 Added {file_count} files...")
                    else:
                        print(f"    ⚠️  Skipping long path: {arcname_str[:50]}...")
                
        # Verify ZIP file creation
        if Path(zip_filename).exists():
            file_size = Path(zip_filename).stat().st_size
            size_mb = file_size / (1024 * 1024)
            print(f"  ✅ Created ZIP: {zip_filename}")
            print(f"  📊 Size: {file_size:,} bytes ({size_mb:.1f} MB)")
            print(f"  📊 Files: {file_count}")
            return True
        else:
            print("❌ ZIP file creation failed")
            return False
            
    except Exception as e:
        print(f"❌ Error creating ZIP file: {e}")
        return False


def update_app_imports(dist_dir):
    """Update the app.py imports to use the renamed 'chart' directory"""
    
    app_path = dist_dir / 'app.py'
    if app_path.exists():
        try:
            with open(app_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Replace drilling_chart imports with chart
            updated_content = content.replace('from drilling_chart', 'from chart')
            updated_content = updated_content.replace('import drilling_chart', 'import chart')
            
            with open(app_path, 'w', encoding='utf-8') as f:
                f.write(updated_content)
            
            print("  ✅ Updated app.py imports for shortened directory name")
            
        except Exception as e:
            print(f"  ⚠️  Warning: Could not update app.py imports: {e}")


def create_installation_helper(dist_dir):
    """Create a helper script to assist with correct installation paths"""
    
    helper_script = r'''@echo off
title Installation Path Helper
color 0E

echo ==========================================
echo   🛠️ Installation Path Helper
echo ==========================================
echo.

echo 📁 Current Timeline Folder:
echo    %CD%
echo.

echo 📋 For MINICONDA installation, use this EXACT path:
echo.
echo    %CD%\miniconda3
echo.

echo 📎 COPY AND PASTE INSTRUCTIONS:
echo.
echo 1. Select the path above with your mouse
echo 2. Right-click and choose "Copy"  
echo 3. In the installer, paste this path as the destination folder
echo 4. Make sure "Just Me" is selected (no admin rights needed)
echo.

echo 🔍 VERIFICATION:
echo    After installation, you should see this folder created:
if exist "miniconda3" echo      ✅ miniconda3 folder - FOUND
if not exist "miniconda3" echo      ❌ miniconda3 folder - NOT FOUND
echo.

echo 📦 INCLUDED INSTALLER:
if exist "Miniconda3-latest-Windows-x86_64.exe" echo      ✅ Miniconda installer - FOUND
if not exist "Miniconda3-latest-Windows-x86_64.exe" echo      ❌ Miniconda installer - NOT FOUND

echo.
echo 💡 TIP: The installer is already included in this package!
echo       Just double-click "Miniconda3-latest-Windows-x86_64.exe"
echo.

pause
'''
    
    with open(dist_dir / 'INSTALL_HELPER.bat', 'w', encoding='utf-8') as f:
        f.write(helper_script)
    
    print("  ✅ Created installation helper (INSTALL_HELPER.bat)")


def create_path_verification_script(dist_dir):
    """Create a script to verify the installation paths are correct"""
    
    verification_script = r'''@echo off
title Path Verification Tool
color 0A

echo ==========================================
echo   🔍 Installation Path Verification
echo ==========================================
echo.

echo 📁 Current Directory: %CD%
echo.

echo 🔎 Checking for Python installations...
echo.

REM Check for Miniconda
if exist "miniconda3\\python.exe" (
    echo ✅ FOUND: miniconda3\\python.exe
    miniconda3\\python.exe --version
    echo    📍 Location: %CD%\\miniconda3\\python.exe
    set PYTHON_FOUND=1
) else (
    echo ❌ NOT FOUND: miniconda3\\python.exe
)

if exist "miniconda3\\Scripts\\python.exe" (
    echo ✅ FOUND: miniconda3\\Scripts\\python.exe  
    miniconda3\\Scripts\\python.exe --version
    echo    📍 Location: %CD%\\miniconda3\\Scripts\\python.exe
    set PYTHON_FOUND=1
) else (
    echo ❌ NOT FOUND: miniconda3\\Scripts\\python.exe
)

echo.

if defined PYTHON_FOUND (
    echo 🎉 SUCCESS: Python installation found in correct location!
    echo 🚀 You can now run SETUP.bat to complete configuration
) else (
    echo ❌ NO PYTHON INSTALLATION FOUND
    echo.
    echo 📋 Next Steps:
    echo    1. Run INSTALL_HELPER.bat to get the correct installation path
    echo    2. Double-click Miniconda3-latest-Windows-x86_64.exe
    echo    3. Use the exact path: %CD%\\miniconda3
    echo    4. Run this verification script again
)

echo.
echo 📁 Current folder contents:
dir /b | findstr /v /c:"VERIFY_PATHS.bat"

echo.
echo 📦 Checking for installer:
if exist "Miniconda3-latest-Windows-x86_64.exe" (
    echo ✅ Miniconda installer found - ready to install
) else (
    echo ❌ Miniconda installer not found
)

echo.
pause
'''
    
    with open(dist_dir / 'VERIFY_PATHS.bat', 'w', encoding='utf-8') as f:
        f.write(verification_script)
    
    print("  ✅ Created path verification tool (VERIFY_PATHS.bat)")


def main():
    """Main execution function with path validation"""
    
    print("🏗️  Timeline Chart Generator - Portable Distribution Creator")
    print("=" * 70)
    print("🔧 Fixed for Windows path length issues")
    print()
    print("⚠️  CRITICAL REQUIREMENT: Destination path MUST NOT contain spaces!")
    print("   ✅ Good: C:\\Users\\Name\\Documents\\Timeline_v1.2_0603\\")
    print("   ❌ Bad:  C:\\Users\\Name\\OneDrive - Company\\Documents\\...")
    print()
    
    # Check if we're in the right directory
    if not os.path.exists('app.py'):
        print("❌ Error: app.py not found.")
        print("   Please run this script from the Timeline Chart Generator directory.")
        return False
    
    if not os.path.exists('drilling_chart'):
        print("❌ Error: drilling_chart package not found.")
        print("   Please ensure you're in the correct project directory.")
        return False
    
    # Get destination path with validation
    print("📁 Choose destination for portable package:")
    print("   Current directory: " + str(Path.cwd()))
    print()
    print("🎯 RECOMMENDED: Use a path WITHOUT SPACES, such as:")
    print("   • C:\\Users\\YourName\\Documents\\Timeline_v1.2_0603")
    print("   • C:\\Tools\\Timeline_v1.2_0603")
    print("   • D:\\Projects\\Timeline_v1.2_0603")
    print()
    
    while True:
        dest_path = input("Enter destination folder path (or press Enter for current directory): ").strip()
        
        if not dest_path:
            dest_path = str(Path.cwd())
            print(f"Using current directory: {dest_path}")
            break
        
        # Validate path doesn't contain spaces
        if ' ' in dest_path:
            print("❌ ERROR: Path contains spaces! This will cause Miniconda installation failures.")
            print("   Please choose a path without spaces (see examples above)")
            continue
        
        # Validate path is reasonable
        try:
            test_path = Path(dest_path)
            if test_path.exists() and not test_path.is_dir():
                print("❌ ERROR: Path exists but is not a directory!")
                continue
            
            # Create parent directories if they don't exist
            test_path.mkdir(parents=True, exist_ok=True)
            print(f"✅ Valid path: {dest_path}")
            
            # Change to destination directory
            os.chdir(dest_path)
            break
            
        except Exception as e:
            print(f"❌ ERROR: Invalid path - {e}")
            continue
    
    # Create the portable distribution
    success = create_portable_timeline_generator()
    if success:
        print("\n" + "=" * 70)
        print("🎉 PORTABLE DISTRIBUTION CREATED SUCCESSFULLY!")
        print("=" * 70)
        print()
        print("🚨 CRITICAL POST-SETUP STEPS:")
        print("   1. Extract/move package to destination WITHOUT SPACES in path")
        print("   2. Run SETUP.bat to install Miniconda")
        print("   3. IMPORTANT: Remove python.exe from main folder after setup")
        print("      Command: Remove-Item \"python.exe\" -Force")
        print("      (Keeps only miniconda3\\python.exe)")
        print()
        print("📤 Ready for Corporate Deployment:")
        print("   • Complete Plotly functionality guaranteed")
        print("   • Windows path length issues resolved")
        print("   • No admin rights required")
        print("   • Works offline after setup")
        print("   • Professional chart generation")
        print("   • Easy troubleshooting support")
        print()
        print("📋 Distribution Instructions:")
        print("   1. Send the .zip file to your colleague")
        print("   2. They extract it to folder WITHOUT SPACES")
        print("   3. They run SETUP.bat once (installs portable Python)")
        print("   4. They delete python.exe from main folder (conflict resolution)")
        print("   5. They use START_APP.bat to run the app")
        print()
        print("✅ All Plotly dependencies will work perfectly!")
        print("📖 See PORTABLE_SETUP_GUIDE.txt for detailed instructions")
        
        return True
    else:
        print("\n❌ Failed to create portable distribution")
        return False


if __name__ == "__main__":
    main()
