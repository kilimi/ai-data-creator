
import React, { useRef, useEffect } from 'react';
import { Image } from '@/types';
import { AnnotationVisualizer } from '@/components/AnnotationVisualizer';
import { AnnotationSample } from '@/utils/annotations';

interface ImageViewportProps {
  image: Image;
  imageDimensions: { width: number; height: number };
  imageLoaded: boolean;
  zoom: number;
  pan: { x: number; y: number };
  isDragging: boolean;
  annotations: (AnnotationSample & { annotationFileName?: string })[];
  annotationKey: number;
  onImageLoad: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onWheel: (e: React.WheelEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onDoubleClick: () => void;
  onImageClick: (e: React.MouseEvent) => void;
}

export const ImageViewport = ({
  image,
  imageDimensions,
  imageLoaded,
  zoom,
  pan,
  isDragging,
  annotations,
  annotationKey,
  onImageLoad,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onDoubleClick,
  onImageClick
}: ImageViewportProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  return (
    <div 
      ref={containerRef}
      className="relative bg-gray-950 rounded-lg overflow-hidden flex items-center justify-center"
      style={{ 
        height: '60vh',
        cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onDoubleClick={onDoubleClick}
    >
      {/* Image and annotations container */}
      <div
        className="relative flex items-center justify-center"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          maxHeight: '60vh',
          maxWidth: '100%'
        }}
        onClick={onImageClick}
      >
        {/* Image container with natural dimensions */}
        <div className="relative">
          <img
            ref={imageRef}
            key={image?.id}
            src={image.url}
            alt={image.fileName}
            className="max-h-full max-w-full object-contain"
            onLoad={onImageLoad}
            draggable={false}
            style={{ 
              maxHeight: '60vh',
              maxWidth: '100%',
              userSelect: 'none'
            }}
          />
        </div>
      </div>
      
      {/* Annotations overlay - positioned absolutely to cover the entire container */}
      {imageLoaded && annotations && annotations.length > 0 && (
        <AnnotationVisualizer
          key={`${image?.id}-${annotationKey}`}
          annotations={annotations}
          imageWidth={imageDimensions.width}
          imageHeight={imageDimensions.height}
          className="absolute inset-0 pointer-events-none"
          showFileName={false}
          zoom={zoom}
          pan={pan}
        />
      )}
    </div>
  );
};
