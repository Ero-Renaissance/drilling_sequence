"""
PyInstaller Build Script for Timeline Chart Generator v1.2_0603
Adapted for the specific Timeline v1.2 file structure and requirements.

This script creates a standalone executable that your colleague can run 
without installing Python, Miniconda, or any dependencies.
"""

import os
import subprocess
import sys
import shutil
from pathlib import Path

def check_environment():
    """Check if we're in the correct Timeline v1.2 environment"""
    
    print("🔍 Checking Timeline v1.2 environment...")
    
    # Check required files exist
    required_files = ['app.py', 'requirements.txt', 'sample_data.csv']
    required_dirs = ['drilling_chart', 'assets']
    
    missing_files = []
    
    for file in required_files:
        if not os.path.exists(file):
            missing_files.append(file)
    
    for dir in required_dirs:
        if not os.path.exists(dir):
            missing_files.append(dir + '/')
    
    if missing_files:
        print(f"❌ Missing required files: {', '.join(missing_files)}")
        print("❌ Please run this script from the Timeline_v1.2_0603 directory")
        return False
    
    print("✅ All required Timeline v1.2 files found")
    return True

def install_pyinstaller_dependencies():
    """Install PyInstaller and build dependencies using the current Python environment"""
    
    print("📦 Installing PyInstaller and build dependencies...")
    
    # Use the current Python interpreter (should be from Miniconda in Timeline folder)
    dependencies = [
        'pyinstaller>=5.13.0',
        'kaleido',  # For Plotly static image export
        'tenacity',  # Required by Plotly
    ]
    
    for dep in dependencies:
        try:
            print(f"   Installing {dep}...")
            result = subprocess.run([sys.executable, '-m', 'pip', 'install', dep], 
                                  check=True, capture_output=True, text=True)
            print(f"✅ Installed: {dep}")
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to install {dep}")
            print(f"   Error: {e.stderr}")
            return False
    
    return True

def create_timeline_spec_file():
    """Create a PyInstaller spec file optimized for Timeline v1.2"""
    
    print("📄 Creating Timeline v1.2 PyInstaller spec file...")
    
    spec_content = '''# -*- mode: python ; coding: utf-8 -*-

import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all Plotly data files and templates (essential for Timeline charts)
plotly_datas = collect_data_files('plotly')
streamlit_datas = collect_data_files('streamlit')

# Collect all Plotly submodules to ensure Timeline charts work
plotly_hiddenimports = collect_submodules('plotly')
streamlit_hiddenimports = collect_submodules('streamlit')

# Additional hidden imports specifically for Timeline Chart Generator
timeline_hiddenimports = [
    # Core Plotly components used by Timeline
    'plotly.graph_objects',
    'plotly.express', 
    'plotly.io',
    'plotly.offline',
    'plotly.tools',
    'plotly.utils',
    'plotly.validators',
    'plotly.graph_objs',
    'plotly.figure_factory',
    'plotly.colors',
    'plotly.subplots',
    '_plotly_utils',
    '_plotly_future_',
    
    # Plotly dependencies
    'kaleido',  # For static image export
    'tenacity',  # Required by Plotly
    'retrying',  # Required by Plotly
    
    # Timeline-specific dependencies
    'pandas',
    'numpy',
    'datetime',
    'json',
    'csv',
    
    # Streamlit dependencies for Timeline UI
    'streamlit.components.v1',
    'streamlit.runtime',
    'streamlit.web',
    'streamlit.cli',
]

# Timeline app entry point
a = Analysis(
    ['app.py'],
    pathex=[os.getcwd()],
    binaries=[],
    datas=plotly_datas + streamlit_datas + [
        # Include all Timeline v1.2 assets and data
        ('drilling_chart', 'drilling_chart'),
        ('assets', 'assets'),
        ('requirements.txt', '.'),
        ('README.md', '.'),
        ('sample_data.csv', '.'),
        ('README.txt', '.'),
    ],
    hiddenimports=plotly_hiddenimports + streamlit_hiddenimports + timeline_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude unnecessary packages to reduce size
        'tkinter',
        'PIL',
        'PyQt5',
        'PyQt6',
        'PySide2',
        'PySide6',
        'matplotlib.backends.qt_compat',
        'matplotlib.backends._backend_tk',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Remove duplicates to optimize size
a.datas = list(set(a.datas))
a.binaries = list(set(a.binaries))

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# Create the Timeline Chart Generator executable
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Timeline_Chart_Generator_v1.2',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Keep console for debugging and to show Streamlit URL
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/app_icon.ico' if os.path.exists('assets/app_icon.ico') else None,
)
'''
    
    with open('timeline_v1.2.spec', 'w') as f:
        f.write(spec_content)
    
    print("✅ Created Timeline v1.2 PyInstaller spec file")

def create_plotly_timeline_hook():
    """Create a custom PyInstaller hook specifically for Timeline's Plotly usage"""
    
    print("🔧 Creating Timeline-optimized Plotly hook...")
    
    hooks_dir = Path('hooks')
    hooks_dir.mkdir(exist_ok=True)
    
    hook_content = '''"""
Custom PyInstaller hook for Timeline Chart Generator's Plotly usage
Ensures all Timeline chart types and interactions work in the standalone executable
"""

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# Collect all Plotly data files (includes templates, assets, etc.)
datas = collect_data_files('plotly')

# Collect all Plotly submodules
hiddenimports = collect_submodules('plotly')

# Add Timeline-specific Plotly components
timeline_plotly_imports = [
    # Core Timeline chart components
    'plotly.graph_objects._figure',
    'plotly.graph_objects._deprecations',
    'plotly.graph_objects.scatter',
    'plotly.graph_objects.bar',
    'plotly.graph_objects.line',
    
    # Plotly I/O for Timeline export features
    'plotly.io._base_renderers',
    'plotly.io._html',
    'plotly.io._json',
    'plotly.io._kaleido',
    'plotly.io._orca',
    'plotly.io._renderers',
    'plotly.io._templates',
    'plotly.io.json',
    
    # Plotly offline for Timeline standalone operation
    'plotly.offline.offline',
    
    # Timeline chart utilities
    'plotly.tools',
    'plotly.utils',
    'plotly.validators',
    
    # Plotly internal utilities
    '_plotly_utils.utils',
    '_plotly_future_',
    
    # Timeline color schemes
    'plotly.colors.qualitative',
    'plotly.colors.sequential',
    'plotly.colors.diverging',
    'plotly.colors.cyclical',
]

hiddenimports += timeline_plotly_imports
'''
    
    hook_file = hooks_dir / 'hook-plotly.py'
    with open(hook_file, 'w') as f:
        f.write(hook_content)
    
    print("✅ Created Timeline-optimized Plotly hook")

def build_timeline_executable():
    """Build the Timeline v1.2 standalone executable"""
    
    print("🔨 Building Timeline Chart Generator v1.2 standalone executable...")
    
    try:
        # Clean previous builds
        if os.path.exists('build'):
            shutil.rmtree('build')
        if os.path.exists('dist'):
            shutil.rmtree('dist')
        
        # Build using the Timeline-specific spec file
        cmd = [
            sys.executable, '-m', 'PyInstaller',
            '--clean',
            '--noconfirm',
            'timeline_v1.2.spec'
        ]
        
        print("   This may take 5-10 minutes depending on your system...")
        result = subprocess.run(cmd, capture_output=False, text=True, cwd=os.getcwd())
        
        if result.returncode == 0:
            exe_path = Path('dist/Timeline_Chart_Generator_v1.2.exe')
            if exe_path.exists():
                size_mb = exe_path.stat().st_size / (1024*1024)
                print(f"✅ Build completed successfully!")
                print(f"📁 Executable: {exe_path.absolute()}")
                print(f"📊 Size: {size_mb:.1f} MB")
                return True
            else:
                print("❌ Build completed but executable not found")
                return False
        else:
            print("❌ Build failed!")
            print(f"   Return code: {result.returncode}")
            return False
            
    except Exception as e:
        print(f"❌ Build error: {e}")
        return False

def create_distribution_package():
    """Create a complete distribution package for your colleague"""
    
    print("📦 Creating distribution package...")
    
    dist_dir = Path('Timeline_Chart_Generator_v1.2_Standalone')
    dist_dir.mkdir(exist_ok=True)
    
    # Copy executable
    exe_source = Path('dist/Timeline_Chart_Generator_v1.2.exe')
    if exe_source.exists():
        shutil.copy2(exe_source, dist_dir / 'Timeline_Chart_Generator_v1.2.exe')
        print("✅ Copied executable")
    else:
        print("❌ Executable not found for distribution")
        return False
    
    # Copy sample data
    if os.path.exists('sample_data.csv'):
        shutil.copy2('sample_data.csv', dist_dir / 'sample_data.csv')
        print("✅ Copied sample data")
    
    # Create quick start guide
    quick_start = '''# Timeline Chart Generator v1.2 - Standalone Edition

## 🚀 Quick Start (No Installation Required!)

1. **Double-click** `Timeline_Chart_Generator_v1.2.exe`
2. **Wait** for the application to start (may take 10-15 seconds first time)
3. **Look for** the browser window that opens automatically
4. **Upload** your CSV data using the interface
5. **Generate** interactive timeline charts instantly!

## 📊 Test with Sample Data
- Use `sample_data.csv` to test the application
- This file shows the expected CSV format for your drilling data

## 🔧 Troubleshooting

### If the application doesn't start:
1. Run from Command Prompt to see error messages
2. Check that Windows Defender isn't blocking the executable
3. Ensure you have sufficient disk space (app extracts ~200MB temporarily)

### If browser doesn't open automatically:
1. Look for "Local URL" in the console window
2. Copy and paste the URL (usually http://localhost:8501) into your browser

### If charts don't display:
- This shouldn't happen with the standalone version
- All Plotly components are embedded in the executable

## 📝 CSV Data Format
Your CSV should contain columns for:
- Date/Time information
- Activity descriptions
- Status indicators
- Any other drilling parameters you want to visualize

## 💡 Features
✅ Interactive timeline charts
✅ Multiple data series support
✅ Zoom, pan, and hover functionality
✅ Export charts as PNG/PDF
✅ No internet connection required
✅ Portable - runs from any location

## 🎯 Corporate Use
- No administrator rights required
- No Python installation needed
- Can run from network drives
- Self-contained with all dependencies
- Secure - no external connections required

---
Generated with Timeline Chart Generator v1.2 PyInstaller Build System
'''
    
    with open(dist_dir / 'README_STANDALONE.txt', 'w') as f:
        f.write(quick_start)
    
    print("✅ Created quick start guide")
    
    # Create distribution info
    print(f"✅ Distribution package created: {dist_dir.absolute()}")
    return True

def create_test_runner():
    """Create a test script to verify the executable works"""
    
    test_content = '''"""
Timeline Chart Generator v1.2 - Executable Test Runner
Use this to verify the standalone executable works correctly
"""

import subprocess
import sys
import os
import time
from pathlib import Path

def test_timeline_executable():
    """Test the Timeline v1.2 standalone executable"""
    
    exe_path = Path('Timeline_Chart_Generator_v1.2_Standalone/Timeline_Chart_Generator_v1.2.exe')
    
    if not exe_path.exists():
        print("❌ Executable not found!")
        print(f"   Expected: {exe_path.absolute()}")
        return False
    
    print("🧪 Testing Timeline Chart Generator v1.2 Executable")
    print("=" * 55)
    
    size_mb = exe_path.stat().st_size / (1024*1024)
    print(f"📁 Executable: {exe_path.name}")
    print(f"📊 Size: {size_mb:.1f} MB")
    
    print("\\n🚀 Starting Timeline Chart Generator...")
    print("   ⏱️  First startup may take 10-15 seconds")
    print("   🌐 Browser should open automatically")
    print("   📝 Try uploading sample_data.csv to test charts")
    print("\\n⏹️  Press Ctrl+C here when you're done testing\\n")
    
    try:
        # Start the Timeline executable
        process = subprocess.Popen([str(exe_path)], 
                                 stdout=subprocess.PIPE, 
                                 stderr=subprocess.STDOUT,
                                 text=True,
                                 bufsize=1,
                                 universal_newlines=True)
        
        print("✅ Timeline Chart Generator started!")
        
        # Show output for a few seconds
        start_time = time.time()
        while time.time() - start_time < 20:  # Show output for 20 seconds
            line = process.stdout.readline()
            if line:
                print(f"   {line.strip()}")
            if "Local URL:" in line or "Network URL:" in line:
                print("\\n🌐 Timeline Chart Generator is ready!")
                break
            if process.poll() is not None:
                break
        
        print("\\n📊 Test the Timeline features:")
        print("   1. Upload CSV data")
        print("   2. Generate timeline charts") 
        print("   3. Test interactive features (zoom, pan, hover)")
        print("   4. Try exporting charts")
        print("\\n⏹️  Press Ctrl+C to stop when done...")
        
        # Wait for user to stop
        try:
            process.wait()
        except KeyboardInterrupt:
            print("\\n🛑 Stopping Timeline Chart Generator...")
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            print("✅ Test completed!")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

if __name__ == "__main__":
    test_timeline_executable()
'''
    
    with open('test_timeline_executable.py', 'w') as f:
        f.write(test_content)
    
    print("✅ Created Timeline executable test runner")

def main():
    """Main Timeline v1.2 build process"""
    
    print("🏗️  Timeline Chart Generator v1.2 - Standalone Executable Builder")
    print("=" * 70)
    print("This will create a single executable file that your colleague")
    print("can run without installing Python, Miniconda, or any dependencies!")
    print("=" * 70)
    
    # Step 1: Check environment
    if not check_environment():
        return False
    
    # Step 2: Install PyInstaller dependencies
    if not install_pyinstaller_dependencies():
        print("❌ Failed to install build dependencies")
        return False
    
    # Step 3: Create Timeline-specific spec file
    create_timeline_spec_file()
    
    # Step 4: Create Timeline-optimized hooks
    create_plotly_timeline_hook()
    
    # Step 5: Build the executable
    success = build_timeline_executable()
    
    if not success:
        print("❌ Build failed. Check error messages above.")
        return False
    
    # Step 6: Create distribution package
    if not create_distribution_package():
        print("❌ Failed to create distribution package")
        return False
    
    # Step 7: Create test runner
    create_test_runner()
    
    # Final success message
    print("\\n🎉 Timeline Chart Generator v1.2 Standalone Build Complete!")
    print("=" * 70)
    print("📦 Distribution package: Timeline_Chart_Generator_v1.2_Standalone/")
    print("📁 Contents:")
    print("   • Timeline_Chart_Generator_v1.2.exe (Main executable)")
    print("   • sample_data.csv (Test data)")
    print("   • README_STANDALONE.txt (Quick start guide)")
    print("\\n🧪 Next steps:")
    print("   1. Run: python test_timeline_executable.py")
    print("   2. Test with your actual drilling data")
    print("   3. Zip the distribution folder")
    print("   4. Send to your colleague!")
    print("\\n✅ Your colleague will NOT need to install:")
    print("   • Python")
    print("   • Miniconda") 
    print("   • Any dependencies")
    print("   • Just double-click the .exe file!")
    
    return True

if __name__ == "__main__":
    main()
