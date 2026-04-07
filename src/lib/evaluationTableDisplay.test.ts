import { describe, it, expect } from 'vitest';
import {
  formatModelTypeShort,
  formatEvaluationModelDisplay,
  getEvaluationRowMetrics,
  formatMetricPct,
} from './evaluationTableDisplay';

describe('formatModelTypeShort', () => {
  it('returns empty string for falsy input', () => {
    expect(formatModelTypeShort(undefined)).toBe('');
    expect(formatModelTypeShort(null)).toBe('');
    expect(formatModelTypeShort('')).toBe('');
  });

  it('returns empty string for "Unknown"', () => {
    expect(formatModelTypeShort('Unknown')).toBe('');
  });

  it('strips .pt extension', () => {
    expect(formatModelTypeShort('yolo11n.pt')).toBe('yolo11n');
  });

  it('strips .pth extension', () => {
    expect(formatModelTypeShort('resnet50.pth')).toBe('resnet50');
  });

  it('strips .onnx extension', () => {
    expect(formatModelTypeShort('model.onnx')).toBe('model');
  });

  it('is case-insensitive for extension', () => {
    expect(formatModelTypeShort('model.PT')).toBe('model');
    expect(formatModelTypeShort('model.ONNX')).toBe('model');
  });

  it('returns raw string if no known extension', () => {
    expect(formatModelTypeShort('yolo11n')).toBe('yolo11n');
  });
});

describe('formatEvaluationModelDisplay', () => {
  it('returns dash for null/undefined metadata', () => {
    expect(formatEvaluationModelDisplay(null)).toBe('—');
    expect(formatEvaluationModelDisplay(undefined)).toBe('—');
  });

  it('returns model type without extension', () => {
    expect(formatEvaluationModelDisplay({ model_type: 'yolo11n.pt' })).toBe('yolo11n');
  });

  it('appends training task name when available', () => {
    const result = formatEvaluationModelDisplay({
      model_type: 'yolo11n.pt',
      training_task_name: 'Road signs v2',
    });
    expect(result).toBe('yolo11n · Road signs v2');
  });

  it('falls back to model_config.model', () => {
    expect(
      formatEvaluationModelDisplay({ model_config: { model: 'rtdetr-l' } })
    ).toBe('rtdetr-l');
  });

  it('ignores "Unknown" model_type and falls back', () => {
    expect(
      formatEvaluationModelDisplay({
        model_type: 'Unknown',
        model_config: { model: 'rtdetr-l' },
      })
    ).toBe('rtdetr-l');
  });

  it('trims whitespace-only task name', () => {
    expect(
      formatEvaluationModelDisplay({
        model_type: 'yolo11n.pt',
        training_task_name: '   ',
      })
    ).toBe('yolo11n');
  });
});

describe('getEvaluationRowMetrics', () => {
  it('returns null for null/undefined metadata', () => {
    expect(
      getEvaluationRowMetrics(null, { isMultiDataset: false, aggregateStatus: '' })
    ).toBeNull();
    expect(
      getEvaluationRowMetrics(undefined, { isMultiDataset: false, aggregateStatus: '' })
    ).toBeNull();
  });

  it('returns results metrics for single dataset', () => {
    const result = getEvaluationRowMetrics(
      { results: { precision: 0.95, recall: 0.88, f1_score: 0.91 } },
      { isMultiDataset: false, aggregateStatus: '' }
    );
    expect(result).toEqual({ precision: 0.95, recall: 0.88, f1: 0.91 });
  });

  it('returns aggregate_results for multi-dataset', () => {
    const result = getEvaluationRowMetrics(
      {
        results: { precision: 0.5, recall: 0.5, f1_score: 0.5 },
        aggregate_results: { precision: 0.9, recall: 0.85, f1_score: 0.87 },
      },
      { isMultiDataset: true, aggregateStatus: 'completed' }
    );
    expect(result).toEqual({ precision: 0.9, recall: 0.85, f1: 0.87 });
  });

  it('returns null for multi-dataset without aggregate_results', () => {
    const result = getEvaluationRowMetrics(
      { results: { precision: 0.95 } },
      { isMultiDataset: true, aggregateStatus: '' }
    );
    expect(result).toBeNull();
  });

  it('defaults recall and f1 to 0 when missing', () => {
    const result = getEvaluationRowMetrics(
      { results: { precision: 0.95 } },
      { isMultiDataset: false, aggregateStatus: '' }
    );
    expect(result).toEqual({ precision: 0.95, recall: 0, f1: 0 });
  });
});

describe('formatMetricPct', () => {
  it('formats 0.95 as "95.0%"', () => {
    expect(formatMetricPct(0.95)).toBe('95.0%');
  });

  it('formats 1.0 as "100.0%"', () => {
    expect(formatMetricPct(1.0)).toBe('100.0%');
  });

  it('formats 0 as "0.0%"', () => {
    expect(formatMetricPct(0)).toBe('0.0%');
  });

  it('returns dash for undefined', () => {
    expect(formatMetricPct(undefined)).toBe('—');
  });

  it('returns dash for NaN', () => {
    expect(formatMetricPct(NaN)).toBe('—');
  });
});
