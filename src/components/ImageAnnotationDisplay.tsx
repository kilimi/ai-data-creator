
import React from 'react';
import { AnnotationSample } from '@/utils/annotations';

interface ImageAnnotationDisplayProps {
  annotations: (AnnotationSample & { annotationFileName?: string })[];
}

// Helper: get display name for annotation
function getAnnotationDisplayName(annotation: AnnotationSample): string {
  // Try different properties that could serve as a name
  if (annotation.id && annotation.id !== annotation.className) return annotation.id;
  if (annotation.annotationFileName) return annotation.annotationFileName;
  
  // If no unique identifier, just return the class name
  return annotation.className;
}

export const ImageAnnotationDisplay = ({ annotations }: ImageAnnotationDisplayProps) => {
  if (!annotations || annotations.length === 0) {
    return <div className="text-sm text-gray-400">No annotations to display</div>;
  }

  return (
    <div className="text-sm text-gray-400">
      <div className="text-left">
        {annotations.map((ann, index) => {
          const displayName = getAnnotationDisplayName(ann);
          return (
            <span key={`${ann.className}-${index}`} className="flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 10, height: 10, background: ann.color || '#ea384c', borderRadius: '50%' }} />
              {ann.className}
              {/* Show actual annotation name if different from class name */}
              {displayName !== ann.className && (
                <span className="opacity-75">({displayName})</span>
              )}
              {index < annotations.length - 1 ? ', ' : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
};
