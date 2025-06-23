
import { useState, useEffect } from 'react';
import { LayoutType } from '@/components/LayoutControls';

interface DatasetSettings {
  imagesPerPage: number;
  imageSize: number;
  layout: LayoutType;
  sliderPosition: number; // Add slider position (0-100)
}

const DEFAULT_SETTINGS: DatasetSettings = {
  imagesPerPage: 20,
  imageSize: 160,
  layout: 'horizontal',
  sliderPosition: 50 // Default 50/50 split
};

export function useDatasetSettings(datasetId: string) {
  const [settings, setSettings] = useState<DatasetSettings>(DEFAULT_SETTINGS);
  
  // Load settings from localStorage on mount
  useEffect(() => {
    if (!datasetId) return;
    
    const storageKey = `dataset-settings-${datasetId}`;
    const storedSettings = localStorage.getItem(storageKey);
    
    console.log('Loading dataset settings for:', datasetId);
    console.log('Stored settings raw:', storedSettings);
    
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        const mergedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        console.log('Loaded settings:', mergedSettings);
        setSettings(mergedSettings);
      } catch (error) {
        console.warn('Failed to parse stored dataset settings:', error);
      }
    } else {
      console.log('No stored settings found, using defaults');
    }
  }, [datasetId]);
  
  // Save settings to localStorage whenever they change
  const updateSettings = (newSettings: Partial<DatasetSettings>) => {
    if (!datasetId) return;
    
    const updatedSettings = { ...settings, ...newSettings };
    console.log('Updating settings:', newSettings);
    console.log('New full settings:', updatedSettings);
    
    setSettings(updatedSettings);
    
    const storageKey = `dataset-settings-${datasetId}`;
    localStorage.setItem(storageKey, JSON.stringify(updatedSettings));
    console.log('Settings saved to localStorage with key:', storageKey);
  };
  
  return {
    settings,
    updateImagesPerPage: (value: number) => updateSettings({ imagesPerPage: value }),
    updateImageSize: (value: number) => updateSettings({ imageSize: value }),
    updateLayout: (value: LayoutType) => updateSettings({ layout: value }),
    updateSliderPosition: (value: number) => updateSettings({ sliderPosition: value })
  };
}
