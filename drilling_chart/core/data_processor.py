"""
Data processing utilities for drilling sequence data.

This module handles data loading, validation, and preparation for chart generation.
"""

import os
import pandas as pd


class DataProcessor:
    """Handles data loading, validation, and preparation"""
    
    @staticmethod
    def load_and_prepare_data(csv_file: str) -> pd.DataFrame:
        """Load and prepare drilling sequence data"""
        print(f"Reading data from {csv_file}...")
        
        if not os.path.exists(csv_file):
            raise FileNotFoundError(f"CSV file not found: {csv_file}")
        
        df = pd.read_csv(csv_file)
        DataProcessor.validate_columns(df)
        
        # Convert dates
        df['Start Date'] = pd.to_datetime(df['Start Date'])
        df['End Date'] = pd.to_datetime(df['End Date'])
        
        # Convert contract expiry date if present
        if 'Rig Contract Expiry Date' in df.columns:
            df['Rig Contract Expiry Date'] = pd.to_datetime(df['Rig Contract Expiry Date'])
            
        # Create custom location ordering: LAND, SWAMP, OFFSHORE
        location_order = ['LAND', 'SWAMP', 'OFFSHORE']
        df['Location_Sort_Order'] = df['Location'].map({loc: i for i, loc in enumerate(location_order)})
        
        # Sort data with custom location ordering
        df = df.sort_values(by=['Location_Sort_Order', 'Rig Name', 'Start Date'], ascending=[False, False, True])
        
        # Remove the temporary sort column
        df = df.drop('Location_Sort_Order', axis=1)
        
        # Create composite labels
        df['Composite Label'] = df['Location'] + " - " + df['Rig Name']
        
        # Convert to categorical
        df['Activity Type'] = pd.Categorical(df['Activity Type'])
        if 'Risk' in df.columns:
            df['Risk'] = pd.Categorical(df['Risk'])
        df['Readiness Check Status'] = pd.Categorical(df['Readiness Check Status'])
        
        return df
        
    @staticmethod
    def validate_columns(df: pd.DataFrame) -> None:
        """Validate DataFrame structure"""
        required_columns = [
            'Start Date', 'End Date', 'Location', 'Rig Name', 'Activity Type',
            'Readiness Check Status', 'Well Name', 'Plan Type', 'Readiness Check',
        ]
        
        optional_columns = ['Risk', 'Comment', 'Rig Contract Expiry Date']
        
        # Check required columns
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            raise ValueError(f"Missing required columns: {', '.join(missing_columns)}")
        
        # Validate date columns
        for col in ['Start Date', 'End Date']:
            try:
                pd.to_datetime(df[col])
            except Exception as e:
                raise ValueError(f"Invalid date format in column '{col}': {str(e)}")
        
        # Check for null values in critical columns
        for col in required_columns:
            if df[col].isna().any():
                null_count = df[col].isna().sum()
                print(f"Warning: Column '{col}' contains {null_count} empty values")
        
        # Report optional columns
        missing_optional = [col for col in optional_columns if col not in df.columns]
        if missing_optional:
            print(f"Note: Missing optional columns: {', '.join(missing_optional)}")

        print("Column validation complete - all required columns present")
