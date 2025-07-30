import '@testing-library/jest-dom';
import { beforeAll, afterEach, afterAll } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { API_CONFIG } from '../config/api';

const baseUrl = API_CONFIG?.baseUrl || 'http://localhost:9999';

export const handlers = [
  http.post(`${baseUrl}/projects`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        id: 1,
        name: 'Test Project',
        description: 'Test Description',
        tags: ['test'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        datasets: [],
        logo_url: null,
        is_project: true
      }
    }, { status: 201 });
  }),

  http.get(`${baseUrl}/projects`, () => {
    return HttpResponse.json({
      success: true,
      data: [
        {
          id: 1,
          name: 'Test Project',
          description: 'Test Description',
          tags: ['test'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          datasets: [],
          logo_url: null,
          is_project: true
        }
      ]
    });
  }),

  http.put(`${baseUrl}/projects/:id`, () => {
    return HttpResponse.json({
      success: true,
      data: {
        id: 1,
        name: 'Updated Project',
        description: 'Updated Description',
        tags: ['updated'],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        datasets: [],
        logo_url: null,
        is_project: true
      }
    });
  }),

  http.delete(`${baseUrl}/projects/:id`, () => {
    return HttpResponse.json({
      success: true
    });
  })
];

const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());