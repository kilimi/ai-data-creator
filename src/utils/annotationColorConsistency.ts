export interface ClassColorSource {
  name: string;
  color: string;
}

export interface AnnotationColorTarget {
  label?: string | null;
  color?: string | null;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

export function applyClassColorsToAnnotations<T extends AnnotationColorTarget>(
  annotations: T[],
  classes: ClassColorSource[],
): T[] {
  if (!annotations.length || !classes.length) {
    return annotations;
  }

  const colorByLabel = new Map<string, string>();
  for (const cls of classes) {
    if (!cls?.name || !cls?.color) {
      continue;
    }
    colorByLabel.set(normalizeLabel(cls.name), cls.color);
  }

  let changed = false;
  const remapped = annotations.map((annotation) => {
    if (!annotation?.label) {
      return annotation;
    }
    const targetColor = colorByLabel.get(normalizeLabel(annotation.label));
    if (!targetColor || targetColor === annotation.color) {
      return annotation;
    }
    changed = true;
    return { ...annotation, color: targetColor };
  });

  return changed ? remapped : annotations;
}
