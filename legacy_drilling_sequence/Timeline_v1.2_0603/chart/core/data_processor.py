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
        """Load and prepare drilling sequence data with versatile column support"""
        print(f"Reading data from {csv_file}...")
        
        if not os.path.exists(csv_file):
            raise FileNotFoundError(f"CSV file not found: {csv_file}")
        
        df = pd.read_csv(csv_file)
        DataProcessor.validate_columns(df)
        
        # Convert dates (mandatory columns)
        df['Start Date'] = pd.to_datetime(df['Start Date'])
        df['End Date'] = pd.to_datetime(df['End Date'])
          # Convert contract expiry date if present
        if 'Rig Contract Expiry Date' in df.columns:
            df['Rig Contract Expiry Date'] = pd.to_datetime(df['Rig Contract Expiry Date'])
        
        # Sort data intelligently based on available columns
        df = DataProcessor._sort_data(df)
        
        # Create composite labels based on available data
        DataProcessor._create_composite_labels(df)
          # Convert to categorical for better performance
        DataProcessor._convert_to_categorical(df)
        
        return df
    
    @staticmethod
    def process_data(df: pd.DataFrame) -> pd.DataFrame:
        """Process DataFrame data with versatile column support"""
        # Validate the DataFrame
        DataProcessor.validate_columns(df)
        
        # Convert dates (mandatory columns)
        df['Start Date'] = pd.to_datetime(df['Start Date'])
        df['End Date'] = pd.to_datetime(df['End Date'])
        
        # Convert contract expiry date if present
        if 'Rig Contract Expiry Date' in df.columns:
            df['Rig Contract Expiry Date'] = pd.to_datetime(df['Rig Contract Expiry Date'])
        
        # Sort data intelligently based on available columns
        df = DataProcessor._sort_data(df)
        
        # Create composite labels based on available data
        DataProcessor._create_composite_labels(df)
        
        # Convert to categorical for better performance
        DataProcessor._convert_to_categorical(df)
        
        return df
        
    @staticmethod
    def validate_columns(df: pd.DataFrame) -> None:
        """Validate DataFrame structure with versatile column support"""
        # Only 3 mandatory columns required
        required_columns = ['Activity Type', 'Start Date', 'End Date']
        
        # Check mandatory columns
        missing_columns = [col for col in required_columns if col not in df.columns]
        if missing_columns:
            raise ValueError(f"Missing required columns: {', '.join(missing_columns)}")
        
        # Validate date columns
        for col in ['Start Date', 'End Date']:
            try:
                pd.to_datetime(df[col])
            except Exception as e:
                raise ValueError(f"Invalid date format in column '{col}': {str(e)}")
        
        # Check for null values in critical columns and warn
        for col in required_columns:
            if df[col].isna().any():
                null_count = df[col].isna().sum()
                print(f"Warning: Column '{col}' contains {null_count} empty values")
        
        # Check for other important columns and warn if they have nulls
        important_optional_columns = ['Readiness Check Status', 'Readiness Check']
        for col in important_optional_columns:
            if col in df.columns and df[col].isna().any():
                null_count = df[col].isna().sum()
                print(f"Warning: Column '{col}' contains {null_count} empty values")

        print("Column validation complete - all required columns present")
    
    @staticmethod
    def _sort_data(df: pd.DataFrame) -> pd.DataFrame:
        """Sort data intelligently based on available columns with location priority preserved"""
        sort_columns = []
        sort_ascending = []
          # If Location exists, apply custom ordering: LAND, SWAMP, OFFSHORE
        if 'Location' in df.columns:
            location_order = ['LAND', 'SWAMP', 'OFFSHORE']
            # Create a mapping for any location not in the predefined order
            location_map = {loc: i for i, loc in enumerate(location_order)}
            # For locations not in the predefined order, assign them a higher number
            df['Location_Sort_Order'] = df['Location'].apply(
                lambda x: location_map.get(x, len(location_order))
            )
            sort_columns.append('Location_Sort_Order')
            sort_ascending.append(True)  # Ascending order so LAND (0) comes first
          # Add resource/equipment column if available (for secondary sorting)
        for col in ['Rig Name', 'Resource', 'Equipment', 'Team', 'Contractor']:
            if col in df.columns:
                sort_columns.append(col)
                sort_ascending.append(False)  # Reverse alphabetical for resources
                break  # Only use the first resource column found
        
        # Always sort by Start Date (mandatory column)
        sort_columns.append('Start Date')
        sort_ascending.append(True)
        
        # Sort the dataframe
        df_sorted = df.sort_values(by=sort_columns, ascending=sort_ascending)
          # Remove the temporary sort column if it exists
        if 'Location_Sort_Order' in df_sorted.columns:
            df_sorted = df_sorted.drop('Location_Sort_Order', axis=1)
        
        return df_sorted
    
    @staticmethod
    def _create_composite_labels(df: pd.DataFrame) -> None:
        """Create composite labels based on available data"""
        # Priority-based labeling using available columns
        descriptive_columns = []
        
        # Check for location-type columns (highest priority for grouping)
        if 'Location' in df.columns:
            descriptive_columns.append('Location')
        
        # Check for resource/equipment columns
        for col in ['Rig Name', 'Resource', 'Equipment', 'Team', 'Contractor']:
            if col in df.columns:
                descriptive_columns.append(col)
                break  # Only use the first resource column found
        
        # Check for item/entity columns
        for col in ['Well Name', 'Item Name', 'Task Name', 'Project Name', 'Name']:
            if col in df.columns:
                descriptive_columns.append(col)
                break  # Only use the first entity column found
        
        # Create composite label based on available descriptive columns
        if len(descriptive_columns) >= 2:
            df['Composite Label'] = df[descriptive_columns[0]] + " - " + df[descriptive_columns[1]]
        elif len(descriptive_columns) == 1:
            df['Composite Label'] = df[descriptive_columns[0]]
        else:
            # Fallback to activity type + sequential number
            df['Composite Label'] = df['Activity Type'] + " " + (df.index + 1).astype(str)
    
    @staticmethod
    def _convert_to_categorical(df: pd.DataFrame) -> None:
        """Convert appropriate columns to categorical for better performance"""
        # Convert Activity Type (mandatory)
        df['Activity Type'] = pd.Categorical(df['Activity Type'])
        
        # Convert optional columns if they exist and have meaningful values
        if 'Risk' in df.columns and df['Risk'].notna().any():
            df['Risk'] = pd.Categorical(df['Risk'])
        
        if 'Readiness Check Status' in df.columns and df['Readiness Check Status'].notna().any():
            df['Readiness Check Status'] = pd.Categorical(df['Readiness Check Status'])
        
        if 'Location' in df.columns:
            df['Location'] = pd.Categorical(df['Location'])
        
        if 'Plan Type' in df.columns:
            df['Plan Type'] = pd.Categorical(df['Plan Type'])
