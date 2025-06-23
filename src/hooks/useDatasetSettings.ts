
import { useState, useEffect } from 'react';
import { LayoutType } from '@/components/LayoutControls';

interface DatasetSettings {
  imagesPerPage: number;
  imageSize: number;
  layout: LayoutType;
}

const DEFAULT_SETTINGS: DatasetSettings = {
  imagesPerPage: 20,
  imageSize: 160,
  layout: 'horizontal'
};

export function useDatasetSettings(datasetId: string) {
  const [settings, setSettings] = useState<DatasetSettings>(DEFAULT_SETTINGS);
  
  // Load settings from localStorage on mount
  useEffect(() => {
    const storageKey = `dataset-settings-${datasetId}`;
    const storedSettings = localStorage.getItem(storageKey);
    
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      } catch (error) {
        console.warn('Failed to parse stored dataset settings:', error);
      }
    }
  }, [datasetId]);
  
  // Save settings to localStorage whenever they change
  const updateSettings = (newSettings: Partial<DatasetSettings>) => {
    const updatedSettings = { ...settings, ...newSettings };
    setSettings(updatedSettings);
    
    const storageKey = `dataset-settings-${datasetId}`;
    localStorage.setItem(storageKey, JSON.stringify(updatedSettings));
  };
  
  return {
    settings,
    updateImagesPerPage: (value: number) => updateSettings({ imagesPerPage: value }),
    updateImageSize: (value: number) => updateSettings({ imageSize: value }),
    updateLayout: (value: LayoutType) => updateSettings({ layout: value })
  };
}
