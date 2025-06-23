
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
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Load settings from localStorage on mount and when datasetId changes
  useEffect(() => {
    console.log('useDatasetSettings effect triggered with datasetId:', datasetId);
    
    if (!datasetId || datasetId.trim() === '') {
      console.log('No valid datasetId, using defaults');
      setSettings(DEFAULT_SETTINGS);
      setIsLoaded(false);
      return;
    }
    
    const storageKey = `dataset-settings-${datasetId}`;
    const storedSettings = localStorage.getItem(storageKey);
    
    console.log('Loading dataset settings for:', datasetId);
    console.log('Storage key:', storageKey);
    console.log('Stored settings raw:', storedSettings);
    
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        const mergedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        console.log('Parsed settings:', parsed);
        console.log('Merged settings:', mergedSettings);
        setSettings(mergedSettings);
        setIsLoaded(true);
      } catch (error) {
        console.warn('Failed to parse stored dataset settings:', error);
        setSettings(DEFAULT_SETTINGS);
        setIsLoaded(true);
      }
    } else {
      console.log('No stored settings found, using defaults');
      setSettings(DEFAULT_SETTINGS);
      setIsLoaded(true);
    }
  }, [datasetId]);
  
  // Save settings to localStorage whenever they change
  const updateSettings = (newSettings: Partial<DatasetSettings>) => {
    if (!datasetId || datasetId.trim() === '') {
      console.warn('Cannot save settings: no valid datasetId');
      return;
    }
    
    const updatedSettings = { ...settings, ...newSettings };
    console.log('Updating settings for datasetId:', datasetId);
    console.log('Settings update:', newSettings);
    console.log('New full settings:', updatedSettings);
    
    setSettings(updatedSettings);
    
    const storageKey = `dataset-settings-${datasetId}`;
    localStorage.setItem(storageKey, JSON.stringify(updatedSettings));
    console.log('Settings saved to localStorage with key:', storageKey);
    console.log('Verification - localStorage now contains:', localStorage.getItem(storageKey));
  };
  
  return {
    settings,
    isLoaded,
    updateImagesPerPage: (value: number) => updateSettings({ imagesPerPage: value }),
    updateImageSize: (value: number) => updateSettings({ imageSize: value }),
    updateLayout: (value: LayoutType) => updateSettings({ layout: value }),
    updateSliderPosition: (value: number) => updateSettings({ sliderPosition: value })
  };
}
