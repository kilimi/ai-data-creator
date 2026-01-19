import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ImageAnnotation from '@/pages/ImageAnnotation';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';

// Mock the hooks
vi.mock('@/hooks/use-api');
vi.mock('@/hooks/use-toast');

// Mock react-router-dom
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '1', projectId: 'project1' }),
    useNavigate: () => vi.fn(),
    useSearchParams: () => [new URLSearchParams()],
  };
});

const mockApi = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

const mockToast = vi.fn();

const mockImages = [
  {
    id: '1',
    fileName: 'test-image-1.jpg',
    url: '/test-images/image1.jpg',
    width: 800,
    height: 600,
  },
  {
    id: '2',
    fileName: 'test-image-2.jpg',
    url: '/test-images/image2.jpg',
    width: 1024,
    height: 768,
  },
];

const renderImageAnnotation = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ImageAnnotation />
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe('ImageAnnotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    (useApi as any).mockReturnValue({ api: mockApi });
    (useToast as any).mockReturnValue({ toast: mockToast });
    
    // Mock successful image loading
    mockApi.get.mockImplementation((url) => {
      if (url.includes('/images')) {
        return Promise.resolve({
          success: true,
          data: mockImages,
        });
      }
      return Promise.resolve({ success: false });
    });

    // Mock HTMLCanvasElement methods
    const mockContext = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
    } as any;

    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;

    // Mock HTMLImageElement
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      get: () => 800,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      get: () => 600,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      get: () => true,
    });
  });

  it('should render loading state initially', () => {
    renderImageAnnotation();
    expect(screen.getByText('Loading images...')).toBeInTheDocument();
  });

  it('should render the annotation interface after loading', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    expect(screen.getByText('Tools')).toBeInTheDocument();
    expect(screen.getByText('Classes')).toBeInTheDocument();
    expect(screen.getByText('Select')).toBeInTheDocument();
    expect(screen.getByText('Rectangle')).toBeInTheDocument();
    expect(screen.getByText('Polygon')).toBeInTheDocument();
  });

  it('should display image navigation controls', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });

    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('should allow adding new classes', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Classes')).toBeInTheDocument();
    });

    // Click the plus button to add a class
    const addButton = screen.getByRole('button', { name: /plus/i });
    fireEvent.click(addButton);

    // Should show input field
    const input = screen.getByPlaceholderText('Class name');
    expect(input).toBeInTheDocument();

    // Type class name and press Enter
    fireEvent.change(input, { target: { value: 'Car' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Should show toast message
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Class added',
      description: 'Class "Car" has been created',
    });
  });

  it('should switch between annotation tools', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Select')).toBeInTheDocument();
    });

    // Click Rectangle tool
    const rectangleButton = screen.getByText('Rectangle');
    fireEvent.click(rectangleButton);
    
    // Click Polygon tool
    const polygonButton = screen.getByText('Polygon');
    fireEvent.click(polygonButton);
  });

  it('should navigate between images', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });

    // Click Next button
    const nextButton = screen.getByText('Next');
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText('2 / 2')).toBeInTheDocument();
    });

    // Click Previous button
    const previousButton = screen.getByText('Previous');
    fireEvent.click(previousButton);

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeInTheDocument();
    });
  });

  it('should show error toast when trying to annotate without selecting a class', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Rectangle')).toBeInTheDocument();
    });

    // Switch to rectangle tool
    const rectangleButton = screen.getByText('Rectangle');
    fireEvent.click(rectangleButton);

    // Try to draw without selecting a class (simulate mouse down on canvas)
    const canvas = document.querySelector('canvas');
    if (canvas) {
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
    }

    expect(mockToast).toHaveBeenCalledWith({
      title: 'No class selected',
      description: 'Please select a class before drawing annotations',
      variant: 'destructive',
    });
  });

  it('should handle save button state correctly', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /save/i });
    expect(saveButton).toBeDisabled(); // Should be disabled when no annotations
  });

  it('should show back navigation button', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Back')).toBeInTheDocument();
    });

    const backButton = screen.getByRole('button', { name: /back/i });
    expect(backButton).toBeInTheDocument();
  });

  it('should display empty state for annotations', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('No annotations yet.')).toBeInTheDocument();
    });

    expect(screen.getByText('Select a class and start drawing!')).toBeInTheDocument();
  });

  it('should handle canvas mouse events', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Select')).toBeInTheDocument();
    });

    const canvas = document.querySelector('canvas');
    expect(canvas).toBeInTheDocument();

    if (canvas) {
      // Test mouse events
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(canvas, { clientX: 150, clientY: 150 });
      fireEvent.mouseUp(canvas);
      fireEvent.doubleClick(canvas);
    }
  });

  it('should show correct image information in header', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Image 1 of 2: test-image-1.jpg')).toBeInTheDocument();
    });
  });
});

describe('ImageAnnotation Canvas Drawing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    (useApi as any).mockReturnValue({ api: mockApi });
    (useToast as any).mockReturnValue({ toast: mockToast });
    
    mockApi.get.mockImplementation((url) => {
      if (url.includes('/images')) {
        return Promise.resolve({
          success: true,
          data: mockImages,
        });
      }
      return Promise.resolve({ success: false });
    });

    // Mock canvas context with more detailed methods
    const mockContext = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      font: '',
    };

    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      bottom: 600,
      right: 800,
      toJSON: () => ({})
    })) as any;

    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      get: () => 800,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      get: () => 600,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      get: () => true,
    });
  });

  it('should create rectangle annotation when drawing with rectangle tool', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Rectangle')).toBeInTheDocument();
    });

    // Add a class first
    const addButton = screen.getByRole('button', { name: /plus/i });
    fireEvent.click(addButton);
    
    const input = screen.getByPlaceholderText('Class name');
    fireEvent.change(input, { target: { value: 'Test Class' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Switch to rectangle tool
    const rectangleButton = screen.getByText('Rectangle');
    fireEvent.click(rectangleButton);

    // Draw rectangle
    const canvas = document.querySelector('canvas');
    if (canvas) {
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 200, clientY: 200 });
      fireEvent.mouseUp(canvas);
    }

    // Should show success toast
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Annotation created',
      description: 'rectangle annotation added for class "Test Class"',
    });
  });

  it('should create polygon annotation when drawing with polygon tool', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Polygon')).toBeInTheDocument();
    });

    // Add a class first
    const addButton = screen.getByRole('button', { name: /plus/i });
    fireEvent.click(addButton);
    
    const input = screen.getByPlaceholderText('Class name');
    fireEvent.change(input, { target: { value: 'Test Class' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Switch to polygon tool
    const polygonButton = screen.getByText('Polygon');
    fireEvent.click(polygonButton);

    // Draw polygon points
    const canvas = document.querySelector('canvas');
    if (canvas) {
      // First point
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100, button: 0 });
      // Second point
      fireEvent.mouseDown(canvas, { clientX: 200, clientY: 100, button: 0 });
      // Third point
      fireEvent.mouseDown(canvas, { clientX: 150, clientY: 200, button: 0 });
      // Complete polygon with double click
      fireEvent.doubleClick(canvas);
    }

    // Should show success toast
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Annotation created',
      description: 'polygon annotation added for class "Test Class"',
    });
  });
});

describe('ImageAnnotation Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    (useApi as any).mockReturnValue({ api: mockApi });
    (useToast as any).mockReturnValue({ toast: mockToast });
  });

  it('should show error toast when failing to load images', async () => {
    mockApi.get.mockRejectedValue(new Error('Network error'));

    renderImageAnnotation();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Failed to load images',
        variant: 'destructive',
      });
    });
  });

  it('should show no images message when dataset is empty', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [],
    });

    renderImageAnnotation();

    await waitFor(() => {
      expect(screen.getByText('No images found in this dataset')).toBeInTheDocument();
    });

    expect(screen.getByText('Back to Dataset')).toBeInTheDocument();
  });
});

describe('ImageAnnotation Save Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
          store[key] = value.toString();
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        },
      };
    })();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: vi.fn(),
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });
    (useToast as any).mockReturnValue({ toast: mockToast });
    
    mockApi.get.mockImplementation((url) => {
      if (url.includes('/images')) {
        return Promise.resolve({
          success: true,
          data: mockImages,
        });
      }
      return Promise.resolve({ success: false });
    });

    // Mock canvas and image setup
    const mockContext = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
    };

    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockContext) as any;
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      bottom: 600,
      right: 800,
      toJSON: () => ({})
    })) as any;

    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      get: () => 800,
      configurable: true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      get: () => 600,
      configurable: true,
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      get: () => true,
      configurable: true,
    });
  });

  it('should show Save button when not in edit mode', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeInTheDocument();
  });

  it('should disable Save button when no annotations exist', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();
  });

  it('should open save dialog when Save button is clicked with annotations', async () => {
    // Pre-populate localStorage with some annotations
    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Save Annotation File')).toBeInTheDocument();
    });

    expect(screen.getByText('Enter a name for your annotation file. All annotations from all images will be saved.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
  });

  it('should show error when clicking Save with no annotations', async () => {
    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'No annotations',
        description: 'Please create some annotations before saving',
        variant: 'destructive',
      });
    });
  });

  it('should allow entering annotation file name in dialog', async () => {
    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'my_test_annotations' } });

    expect(input).toHaveValue('my_test_annotations');
  });

  it('should disable Save button in dialog when name is empty', async () => {
    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Save Annotation File')).toBeInTheDocument();
    });

    const dialogSaveButton = screen.getAllByRole('button', { name: /save/i }).find(
      btn => btn.closest('[role="dialog"]')
    );
    expect(dialogSaveButton).toBeDisabled();
  });

  it('should call uploadCocoAnnotationFile when saving with valid name', async () => {
    const mockUploadFunc = vi.fn().mockResolvedValue({
      success: true,
      data: {
        annotation_file_id: 'file123',
        message: 'File uploaded successfully',
      }
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: mockUploadFunc,
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });

    // Pre-populate with annotations
    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    // Store classes in localStorage
    window.localStorage.setItem('classes_1', JSON.stringify([
      { id: 'class1', name: 'Test Class', color: '#FF0000', visible: true, count: 1 }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'my_test_annotations' } });

    const dialogSaveButton = screen.getAllByRole('button', { name: /save/i }).find(
      btn => btn.closest('[role="dialog"]')
    );
    
    if (dialogSaveButton) {
      fireEvent.click(dialogSaveButton);
    }

    await waitFor(() => {
      expect(mockUploadFunc).toHaveBeenCalledWith(
        1,
        expect.any(File)
      );
    });

    // Verify the file content
    const call = mockUploadFunc.mock.calls[0];
    const file = call[1] as File;
    expect(file.name).toBe('my_test_annotations.json');
    expect(file.type).toBe('application/json');
  });

  it('should show success toast after successful save', async () => {
    const mockUploadFunc = vi.fn().mockResolvedValue({
      success: true,
      data: {
        annotation_file_id: 'file123',
        message: 'File uploaded successfully',
      }
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: mockUploadFunc,
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });

    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    window.localStorage.setItem('classes_1', JSON.stringify([
      { id: 'class1', name: 'Test Class', color: '#FF0000', visible: true, count: 1 }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'my_test_annotations' } });

    const dialogSaveButton = screen.getAllByRole('button', { name: /save/i }).find(
      btn => btn.closest('[role="dialog"]')
    );
    
    if (dialogSaveButton) {
      fireEvent.click(dialogSaveButton);
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Saved successfully',
        description: expect.stringContaining('my_test_annotations.json'),
      });
    });
  });

  it('should close dialog after successful save', async () => {
    const mockUploadFunc = vi.fn().mockResolvedValue({
      success: true,
      data: {
        annotation_file_id: 'file123',
        message: 'File uploaded successfully',
      }
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: mockUploadFunc,
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });

    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    window.localStorage.setItem('classes_1', JSON.stringify([
      { id: 'class1', name: 'Test Class', color: '#FF0000', visible: true, count: 1 }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Save Annotation File')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'my_test_annotations' } });

    const dialogSaveButton = screen.getAllByRole('button', { name: /save/i }).find(
      btn => btn.closest('[role="dialog"]')
    );
    
    if (dialogSaveButton) {
      fireEvent.click(dialogSaveButton);
    }

    await waitFor(() => {
      expect(screen.queryByText('Save Annotation File')).not.toBeInTheDocument();
    });
  });

  it('should show error toast when save fails', async () => {
    const mockUploadFunc = vi.fn().mockResolvedValue({
      success: false,
      error: 'Upload failed',
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: mockUploadFunc,
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });

    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    window.localStorage.setItem('classes_1', JSON.stringify([
      { id: 'class1', name: 'Test Class', color: '#FF0000', visible: true, count: 1 }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'my_test_annotations' } });

    const dialogSaveButton = screen.getAllByRole('button', { name: /save/i }).find(
      btn => btn.closest('[role="dialog"]')
    );
    
    if (dialogSaveButton) {
      fireEvent.click(dialogSaveButton);
    }

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Save failed',
        description: 'Upload failed',
        variant: 'destructive',
      });
    });
  });

  it('should automatically add .json extension if not provided', async () => {
    const mockUploadFunc = vi.fn().mockResolvedValue({
      success: true,
      data: {
        annotation_file_id: 'file123',
        message: 'File uploaded successfully',
      }
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: mockUploadFunc,
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });

    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    window.localStorage.setItem('classes_1', JSON.stringify([
      { id: 'class1', name: 'Test Class', color: '#FF0000', visible: true, count: 1 }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'my_annotations_without_extension' } });

    const dialogSaveButton = screen.getAllByRole('button', { name: /save/i }).find(
      btn => btn.closest('[role="dialog"]')
    );
    
    if (dialogSaveButton) {
      fireEvent.click(dialogSaveButton);
    }

    await waitFor(() => {
      expect(mockUploadFunc).toHaveBeenCalled();
    });

    const call = mockUploadFunc.mock.calls[0];
    const file = call[1] as File;
    expect(file.name).toBe('my_annotations_without_extension.json');
  });

  it('should allow canceling the save dialog', async () => {
    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Save Annotation File')).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(screen.queryByText('Save Annotation File')).not.toBeInTheDocument();
    });
  });

  it('should allow saving with Enter key in input field', async () => {
    const mockUploadFunc = vi.fn().mockResolvedValue({
      success: true,
      data: {
        annotation_file_id: 'file123',
        message: 'File uploaded successfully',
      }
    });

    const mockApiWithUpload = {
      ...mockApi,
      uploadCocoAnnotationFile: mockUploadFunc,
    };
    
    (useApi as any).mockReturnValue({ api: mockApiWithUpload });

    window.localStorage.setItem('annotations_1_test-image-1.jpg', JSON.stringify([
      {
        id: 'ann1',
        type: 'polygon',
        points: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 150, y: 200 }],
        label: 'Test Class',
        color: '#FF0000',
        visible: true,
      }
    ]));

    window.localStorage.setItem('classes_1', JSON.stringify([
      { id: 'class1', name: 'Test Class', color: '#FF0000', visible: true, count: 1 }
    ]));

    renderImageAnnotation();
    
    await waitFor(() => {
      expect(screen.getByText('Segmentation Annotation')).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g., my_segmentation_annotations')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('e.g., my_segmentation_annotations');
    fireEvent.change(input, { target: { value: 'enter_key_test' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockUploadFunc).toHaveBeenCalled();
    });
  });
});
