import { describe, it, expect, beforeEach } from 'vitest';
import { getApiBaseUrl } from './api';

describe('getApiBaseUrl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default URL when nothing is configured', () => {
    expect(getApiBaseUrl()).toBe('http://localhost:9999');
  });

  it('returns localStorage value when set', () => {
    localStorage.setItem('apiBaseUrl', 'http://custom:5000');
    expect(getApiBaseUrl()).toBe('http://custom:5000');
  });

  it('prefers localStorage over default', () => {
    localStorage.setItem('apiBaseUrl', 'http://saved:1234');
    expect(getApiBaseUrl()).toBe('http://saved:1234');
  });
});
