import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrainModelModal } from "@/components/TrainModelModal";
import { Dataset, DatasetGroup } from "@/types";

// Mock dependencies
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({ api: mockApi }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/YoloSettingsDialog", () => ({
  YoloSettingsDialog: ({ open, onOpenChange, initialSettings, onSave }: any) =>
    open ? (
      <div data-testid="yolo-settings-dialog">
        <button onClick={() => onOpenChange(false)}>Close</button>
        <button
          onClick={() => {
            onSave(initialSettings);
            onOpenChange(false);
          }}
        >
          Save
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/RFDETRSettingsDialog", () => ({
  RFDETRSettingsDialog: ({ open, onOpenChange, initialSettings, onSave }: any) =>
    open ? (
      <div data-testid="rfdetr-settings-dialog">
        <button onClick={() => onOpenChange(false)}>Close</button>
        <button
          onClick={() => {
            onSave(initialSettings);
            onOpenChange(false);
          }}
        >
          Save
        </button>
      </div>
    ) : null,
}));

vi.mock("@/components/TrainingStartedDialog", () => ({
  TrainingStartedDialog: ({ open, onOpenChange, taskId }: any) =>
    open ? (
      <div data-testid="training-started-dialog">
        Task ID: {taskId}
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

vi.mock("@/utils/trainingCloneSettings", () => ({
  parseYoloPresetFromModelType: vi.fn((model: string) => ({
    version: "yolo11",
    size: "n",
    task: "segmentation",
    modelSize: model,
  })),
  rtdetrVariantFromStored: vi.fn((model: string) => model),
}));

// Mock Lucide icons (must include every icon used by TrainModelModal and its children, e.g. dialog.tsx uses X)
vi.mock("lucide-react", () => ({
  Brain: () => <div>Brain Icon</div>,
  Database: () => <div>Database Icon</div>,
  Settings: () => <div>Settings Icon</div>,
  Trash2: () => <div>Trash Icon</div>,
  Plus: () => <div>Plus Icon</div>,
  Image: () => <div>Image Icon</div>,
  FileText: () => <div>FileText Icon</div>,
  Wand2: () => <div>Wand Icon</div>,
  Check: () => <div>Check Icon</div>,
  ChevronDown: () => <div>ChevronDown Icon</div>,
  ChevronRight: () => <div>ChevronRight Icon</div>,
  Users: () => <div>Users Icon</div>,
  Info: () => <div>Info Icon</div>,
  X: () => <div>X Icon</div>,
  Loader2: () => <div>Loader2 Icon</div>,
  AlertCircle: () => <div>AlertCircle Icon</div>,
  ChevronUp: () => <div>ChevronUp Icon</div>,
  Search: () => <div>Search Icon</div>,
}));

// Mock API
const mockApi = {
  getImageCollections: vi.fn(),
  getAnnotations: vi.fn(),
  startYoloTraining: vi.fn(),
  startRTDETRTraining: vi.fn(),
  getTask: vi.fn(),
};

const mockToast = vi.fn();

// Test data
const mockDataset1 = {
  id: "1",
  name: "Dataset 1",
  description: "Test dataset 1",
  project_id: "456",
  image_count: 100,
  annotation_file_count: 1,
  annotation_files: [],
  tags: [],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
} as unknown as Dataset;

const mockDataset2 = {
  id: "2",
  name: "Dataset 2",
  description: "Test dataset 2",
  project_id: "456",
  image_count: 200,
  annotation_file_count: 1,
  annotation_files: [],
  tags: [],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
} as unknown as Dataset;

const mockDatasetGroup = {
  id: "group1",
  name: "Test Group",
  description: "Test group",
  project_id: "456",
  datasets: [mockDataset1, mockDataset2],
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
} as unknown as DatasetGroup;

describe("TrainModelModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses
    mockApi.getImageCollections.mockResolvedValue({
      success: true,
      data: [{ name: "collection1" }, { name: "collection2" }],
    });

    mockApi.getAnnotations.mockResolvedValue({
      success: true,
      data: [
        { id: "ann1", name: "annotations1.json", type: "coco" },
        { id: "ann2", name: "annotations2.json", type: "yolo" },
      ],
    });

    mockApi.startYoloTraining.mockResolvedValue({
      success: true,
      data: { task_id: "task123" },
    });

    mockApi.getTask.mockResolvedValue({
      success: true,
      data: {
        task_metadata: {
          dataset_configs: [
            {
              dataset_id: 1,
              annotation_file_id: "ann1",
              image_collection: "collection1",
              split: { train: 80, val: 20, test: 0 },
            },
          ],
          model_type: "yolo11n-seg.pt",
          training_params: {
            epochs: 100,
            batch_size: 16,
          },
        },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderModal = (props = {}) => {
    return render(
      <TrainModelModal
        open={true}
        onOpenChange={vi.fn()}
        datasets={[mockDataset1, mockDataset2]}
        datasetGroups={[mockDatasetGroup]}
        projectId="456"
        {...props}
      />
    );
  };

  const addSingleDataset = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: /add/i }));
    const items = await screen.findAllByRole("menuitem", { name: /add dataset/i });
    const target = items.find((el) => /add dataset$/i.test((el.textContent || "").trim()) || !/group/i.test((el.textContent || "").toLowerCase()));
    if (!target) throw new Error("Add Dataset menu item not found");
    await user.click(target);
  };

  const flushMicrotasks = async () => {
    await Promise.resolve();
  };

  it("renders modal when open", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: /train model/i })).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByText("Train Model")).not.toBeInTheDocument();
  });

  it("generates unique IDs for dataset selections without collisions", async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();

    // Click add dataset button multiple times rapidly
    await addSingleDataset(user);
    await addSingleDataset(user);
    await addSingleDataset(user);

    await flushMicrotasks();

    // Verify that API was called for each dataset (unique selections created)
    await waitFor(() => {
      expect(mockApi.getImageCollections).toHaveBeenCalledTimes(3);
    });

    // All calls should be with dataset ID 1 (first dataset)
    expect(mockApi.getImageCollections).toHaveBeenCalledWith("1");
  });

  it("fetches collections and annotations when dataset is added", async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();

    await addSingleDataset(user);

    await flushMicrotasks();

    await waitFor(() => {
      expect(mockApi.getImageCollections).toHaveBeenCalledWith("1");
      expect(mockApi.getAnnotations).toHaveBeenCalledWith("1");
    });
  });

  it("cancels previous fetch when new fetch starts for same selection", async () => {
    const user = userEvent.setup({ delay: null });
    
    // Mock slow API calls
    let resolveFirst: any;
    let resolveSecond: any;
    mockApi.getImageCollections
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = () =>
              resolve({
                success: true,
                data: [{ name: "old-collection" }],
              });
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = () =>
              resolve({
                success: true,
                data: [{ name: "new-collection" }],
              });
          })
      );

    mockApi.getAnnotations.mockResolvedValue({
      success: true,
      data: [{ id: "ann1", name: "annotations.json" }],
    });

    renderModal();

    // Add dataset
    await addSingleDataset(user);

    await flushMicrotasks();

    // Change dataset selection (triggers new fetch for same selection)
    const datasetSelect = screen.getAllByRole("combobox")[0];
    await user.click(datasetSelect);
    
    // Select second dataset
    const dataset2Option = screen.getByText("Dataset 2");
    await user.click(dataset2Option);

    // Resolve second fetch first
    resolveSecond();
    await flushMicrotasks();

    // Now resolve first fetch (should be ignored)
    resolveFirst();
    await flushMicrotasks();

    // Verify only new collection appears (old one was cancelled)
    await waitFor(() => {
      expect(screen.queryByText("old-collection")).not.toBeInTheDocument();
    });
  });

  it("rate limits parallel fetches when adding dataset group", async () => {
    // Dialog + nested menus set `pointer-events: none` on `body`; allow synthetic clicks.
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderModal();

    // Open dropdown to add dataset group
    await user.click(screen.getByRole("button", { name: /add/i }));

    // Hover submenu trigger so Radix mounts sub-content (pointer-open)
    const addGroupTrigger = await screen.findByRole("menuitem", { name: /add dataset group/i });
    await user.hover(addGroupTrigger);

    const groupOption = await screen.findByTestId("train-modal-add-dataset-group-group1");
    // Submenu item: userEvent often does not activate Radix MenuItem select inside Dialog (jsdom).
    fireEvent.click(groupOption);

    // Both datasets in the selected group should eventually trigger fetches
    await waitFor(() => {
      expect(mockApi.getImageCollections).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });

    // Verify calls were for different datasets
    expect(mockApi.getImageCollections).toHaveBeenCalledWith("1");
    expect(mockApi.getImageCollections).toHaveBeenCalledWith("2");
  });

  it("cleans up abort controllers on unmount", async () => {
    const user = userEvent.setup({ delay: null });

    // Mock slow API call that doesn't resolve
    mockApi.getImageCollections.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    const { unmount } = renderModal();

    // Add dataset to trigger fetch
    await addSingleDataset(user);

    await flushMicrotasks();

    // Verify fetch was initiated
    expect(mockApi.getImageCollections).toHaveBeenCalled();

    // Unmount component - should cancel the fetch
    unmount();

    // No errors should occur from state updates after unmount
    await flushMicrotasks();
  });

  it("does not update state after unmount", async () => {
    const user = userEvent.setup({ delay: null });

    let resolveFetch: any;
    mockApi.getImageCollections.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = () =>
            resolve({
              success: true,
              data: [{ name: "collection" }],
            });
        })
    );

    mockApi.getAnnotations.mockResolvedValue({
      success: true,
      data: [{ id: "ann1", name: "annotations.json" }],
    });

    const { unmount } = renderModal();

    // Add dataset to trigger fetch
    await addSingleDataset(user);

    await flushMicrotasks();

    // Unmount before fetch resolves
    unmount();

    // Now resolve the fetch
    resolveFetch();
    await flushMicrotasks();

    // No errors should occur - state updates should be prevented
  });

  it("loads cloned task settings", async () => {
    const onOpenChange = vi.fn();

    renderModal({
      cloneFromTaskId: 123,
      resourcesLoading: false,
    });

    await flushMicrotasks();

    await waitFor(() => {
      expect(mockApi.getTask).toHaveBeenCalledWith(123);
    });

    // Should show success toast
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Training form filled",
        })
      );
    });
  });

  it("validates form before allowing training", async () => {
    renderModal();

    // Train button should be disabled initially (no datasets selected)
    const trainButton = screen.getByRole("button", { name: /train model/i });
    expect(trainButton).toBeDisabled();
  });

  it("enables train button when form is complete", async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();

    // Add dataset
    await addSingleDataset(user);

    await flushMicrotasks();

    // Wait for data to load
    await waitFor(() => {
      expect(mockApi.getImageCollections).toHaveBeenCalled();
      expect(mockApi.getAnnotations).toHaveBeenCalled();
    });

    // Select model type via model card
    await user.click(screen.getByText("YOLO"));

    // Select image collection (dataset, collection, annotation comboboxes)
    const collectionSelect = screen.getAllByRole("combobox")[1];
    await user.click(collectionSelect);
    const collection1 = screen.getByText("collection1");
    await user.click(collection1);

    // Select annotation
    const annotationSelect = screen.getAllByRole("combobox")[2];
    await user.click(annotationSelect);
    const annotation1 = screen.getByText("annotations1.json");
    await user.click(annotation1);

    // Train button should now be enabled
    const trainButton = screen.getByRole("button", { name: /train model/i });
    expect(trainButton).not.toBeDisabled();
  });

  it("starts YOLO training with correct parameters", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = vi.fn();
    mockApi.getImageCollections.mockResolvedValue({
      success: true,
      data: [{ name: "collection1" }],
    });
    mockApi.getAnnotations.mockResolvedValue({
      success: true,
      data: [{ id: "ann1", name: "annotations1.json", type: "coco" }],
    });

    renderModal({ onOpenChange });

    // Add dataset
    await addSingleDataset(user);

    await flushMicrotasks();

    // Wait for data to load
    await waitFor(() => {
      expect(mockApi.getImageCollections).toHaveBeenCalled();
    });

    // Select YOLO model via model card
    await user.click(screen.getByRole("heading", { name: "YOLO" }));

    // Auto-selection should choose first/only options
    await flushMicrotasks();

    // Start training
    const trainButton = screen.getByRole("button", { name: /train model/i });
    await waitFor(() => expect(trainButton).not.toBeDisabled());
    await user.click(trainButton);

    await flushMicrotasks();

    await waitFor(() => {
      expect(mockApi.startYoloTraining).toHaveBeenCalled();
    });

    // Verify request structure
    const trainingRequest = mockApi.startYoloTraining.mock.calls[0][0];
    expect(trainingRequest).toHaveProperty("project_id", 456);
    expect(trainingRequest).toHaveProperty("dataset_configs");
    expect(trainingRequest.dataset_configs).toHaveLength(1);
    expect(trainingRequest).toHaveProperty("model_type");
    expect(trainingRequest).toHaveProperty("epochs");

    // Modal should close
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("removes dataset selection when trash button clicked", async () => {
    const user = userEvent.setup({ delay: null });
    renderModal();

    // Add dataset
    await addSingleDataset(user);

    await flushMicrotasks();

    // Wait for selected dataset card to appear
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /remove dataset selection/i })).toBeInTheDocument();
    });

    // Click remove button
    const removeButton = screen.getByRole("button", { name: /remove dataset selection/i });
    await user.click(removeButton);

    // Selected dataset card should be removed
    expect(screen.getByText("No datasets selected")).toBeInTheDocument();
  });

  it("auto-selects when only one option available", async () => {
    // Mock single collection and annotation
    mockApi.getImageCollections.mockResolvedValue({
      success: true,
      data: [{ name: "only-collection" }],
    });

    mockApi.getAnnotations.mockResolvedValue({
      success: true,
      data: [{ id: "only-ann", name: "only-annotation.json" }],
    });

    const user = userEvent.setup({ delay: null });
    renderModal();

    // Add dataset
    await addSingleDataset(user);

    await flushMicrotasks();

    // Wait for auto-selection (Radix Select renders text in trigger, not input value)
    await waitFor(() => {
      expect(screen.getAllByText("only-collection").length).toBeGreaterThan(0);
      expect(screen.getAllByText("only-annotation.json").length).toBeGreaterThan(0);
    });
  });

  it("resets form when modal closes", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = vi.fn();

    const { rerender } = renderModal({ onOpenChange });

    // Add dataset
    await addSingleDataset(user);

    await flushMicrotasks();

    // Close modal
    rerender(
      <TrainModelModal
        open={false}
        onOpenChange={onOpenChange}
        datasets={[mockDataset1, mockDataset2]}
        datasetGroups={[mockDatasetGroup]}
        projectId="456"
      />
    );

    // Reopen modal
    rerender(
      <TrainModelModal
        open={true}
        onOpenChange={onOpenChange}
        datasets={[mockDataset1, mockDataset2]}
        datasetGroups={[mockDatasetGroup]}
        projectId="456"
      />
    );

    // Form should be reset (no datasets selected)
    expect(screen.queryByText("Dataset 1")).not.toBeInTheDocument();
  });
});
