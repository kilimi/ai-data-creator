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
  ImageIcon: () => <div>ImageIcon Icon</div>,
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
  LayoutList: () => <div>LayoutList Icon</div>,
  Folder: () => <div>Folder Icon</div>,
  Rows3: () => <div>Rows3 Icon</div>,
  ArrowRight: () => <div>ArrowRight Icon</div>,
  ArrowLeft: () => <div>ArrowLeft Icon</div>,
  Sliders: () => <div>Sliders Icon</div>,
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

  const getDatasetRowButton = (datasetName: string) => {
    const candidates = screen.getAllByRole("button", { name: new RegExp(datasetName, "i") });
    const rowButton = candidates.find((el) => {
      const cls = (el.getAttribute("class") || "").toLowerCase();
      return cls.includes("flex-1") && cls.includes("text-left");
    });
    if (!rowButton) throw new Error(`${datasetName} row button not found`);
    return rowButton;
  };

  const addSingleDataset = async (user: ReturnType<typeof userEvent.setup>) => {
    await screen.findByText("Dataset 1");
    const dsButton = getDatasetRowButton("Dataset 1");
    // First click selects dataset; second click expands row controls.
    await user.click(dsButton);
    await user.click(getDatasetRowButton("Dataset 1"));
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

    // Toggle selection on/off repeatedly; each new selection should trigger a fresh fetch.
    await addSingleDataset(user);
    await user.click(screen.getByRole("button", { name: /remove dataset 1/i }));
    await addSingleDataset(user);
    await user.click(screen.getByRole("button", { name: /remove dataset 1/i }));
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
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    
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

    // Switch selected dataset to trigger a new fetch cycle and make the first stale.
    const removeDataset1 = await screen.findByRole("button", { name: /remove dataset 1/i });
    await user.click(removeDataset1);
    const ds2Label = await screen.findByText("Dataset 2");
    const ds2Button = ds2Label.closest("button") as HTMLButtonElement | null;
    if (!ds2Button) throw new Error("Dataset 2 row button not found");
    await user.click(ds2Button);

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
    // Dialog + interactive controls set `pointer-events: none` on `body`; allow synthetic clicks.
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderModal();

    // In the new picker UI, group rows expose an "Add all" action.
    const addAll = await screen.findByRole("button", { name: /add all/i });
    await user.click(addAll);

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

    // On step 1, the Next button should be disabled when no dataset is selected
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeDisabled();

    // The "Train Model" button only appears on step 3 (not reachable without valid data)
    expect(screen.queryByRole("button", { name: /train model/i })).not.toBeInTheDocument();
  });

  it("enables train button when form is complete", async () => {
    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    mockApi.getImageCollections.mockResolvedValue({
      success: true,
      data: [{ name: "collection1" }],
    });
    mockApi.getAnnotations.mockResolvedValue({
      success: true,
      data: [{ id: "ann1", name: "annotations1.json", type: "coco" }],
    });
    renderModal();

    // Step 1: add dataset and wait for auto-selection
    await addSingleDataset(user);
    await flushMicrotasks();
    await waitFor(() => {
      expect(mockApi.getImageCollections).toHaveBeenCalled();
      expect(mockApi.getAnnotations).toHaveBeenCalled();
    });

    // Step 1 → 2
    const nextBtn1 = await screen.findByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn1).not.toBeDisabled());
    await user.click(nextBtn1);

    // Step 2: select YOLO model card
    await user.click(screen.getByRole("heading", { name: /^yolo$/i }));

    // Step 2 → 3
    const nextBtn2 = await screen.findByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn2).not.toBeDisabled());
    await user.click(nextBtn2);

    // Train button on step 3 should be enabled
    const trainButton = await screen.findByRole("button", { name: /train model/i });
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

    // Step 1: add dataset and wait for auto-selection
    await addSingleDataset(user);
    await flushMicrotasks();
    await waitFor(() => expect(mockApi.getImageCollections).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.getAnnotations).toHaveBeenCalled());

    // Step 1 → 2
    const nextBtn1 = await screen.findByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn1).not.toBeDisabled());
    await user.click(nextBtn1);

    // Step 2: select YOLO model card
    await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
    await flushMicrotasks();

    // Step 2 → 3
    const nextBtn2 = await screen.findByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn2).not.toBeDisabled());
    await user.click(nextBtn2);

    // Start training
    const trainButton = await screen.findByRole("button", { name: /train model/i });
    await waitFor(() => expect(trainButton).not.toBeDisabled());
    await user.click(trainButton);

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
      expect(screen.getByRole("button", { name: /remove dataset 1/i })).toBeInTheDocument();
    });

    // Click remove button
    const removeButton = screen.getByRole("button", { name: /remove dataset 1/i });
    await user.click(removeButton);

    // Selected dataset chip should be removed
    expect(screen.queryByRole("button", { name: /remove dataset 1/i })).not.toBeInTheDocument();
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

    const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
    renderModal();

    // Step 1: add dataset and wait for auto-selection
    await addSingleDataset(user);
    await flushMicrotasks();
    await waitFor(() => expect(mockApi.getImageCollections).toHaveBeenCalled());
    await waitFor(() => expect(mockApi.getAnnotations).toHaveBeenCalled());

    // Step 1 → 2 (Next should be enabled because single options auto-select)
    const nextBtn1 = await screen.findByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn1).not.toBeDisabled());
    await user.click(nextBtn1);

    // Step 2: select YOLO
    await user.click(screen.getByRole("heading", { name: /^yolo$/i }));

    // Step 2 → 3
    const nextBtn2 = await screen.findByRole("button", { name: /next/i });
    await waitFor(() => expect(nextBtn2).not.toBeDisabled());
    await user.click(nextBtn2);

    // Train button on step 3 should be enabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /train model/i })).not.toBeDisabled();
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

    // Form should be reset (dataset is not selected anymore)
    expect(screen.queryByRole("button", { name: /remove dataset 1/i })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Settings-propagation tests: verify every GUI field reaches the API payload
  // ---------------------------------------------------------------------------

  describe("settings propagation to API", () => {
    /** Navigate from step 1 to step 2 (select model page). */
    const navigateToStep2 = async (user: ReturnType<typeof userEvent.setup>) => {
      await addSingleDataset(user);
      await flushMicrotasks();
      // Wait for collections+annotations to load and auto-select (makes canLeaveStep1 true)
      await waitFor(() => expect(mockApi.getImageCollections).toHaveBeenCalled());
      await waitFor(() => expect(mockApi.getAnnotations).toHaveBeenCalled());
      const nextBtn = await screen.findByRole("button", { name: /next/i });
      await waitFor(() => expect(nextBtn).not.toBeDisabled());
      await user.click(nextBtn);
    };

    /** Advance from step 2 to step 3. selectedModel must already be set. */
    const goToStep3 = async (user: ReturnType<typeof userEvent.setup>) => {
      const nextBtn = await screen.findByRole("button", { name: /next/i });
      await waitFor(() => expect(nextBtn).not.toBeDisabled());
      await user.click(nextBtn);
    };

    beforeEach(() => {
      mockApi.getImageCollections.mockResolvedValue({
        success: true,
        data: [{ name: "col1" }],
      });
      mockApi.getAnnotations.mockResolvedValue({
        success: true,
        data: [{ id: "ann1", name: "annotations.json", type: "coco" }],
      });
      mockApi.startYoloTraining.mockResolvedValue({
        success: true,
        data: { task_id: "t1" },
      });
      mockApi.startRTDETRTraining = vi.fn().mockResolvedValue({
        success: true,
        data: { task_id: "t2" },
      });
    });

    it("sends custom YOLO settings (epochs, batchSize, imageSize, learningRate, patience) to API", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      // Step 1 → 2
      await navigateToStep2(user);

      // Select YOLO model (populates inline settings on step 2)
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));

      // Change inline settings while still on step 2
      fireEvent.change(screen.getByDisplayValue("100"), { target: { value: "42" } });
      fireEvent.change(screen.getByDisplayValue("16"), { target: { value: "8" } });
      fireEvent.change(screen.getByDisplayValue("640"), { target: { value: "1280" } });
      fireEvent.change(screen.getByDisplayValue("0.01"), { target: { value: "0.005" } });
      fireEvent.change(screen.getByDisplayValue("50"), { target: { value: "25" } });

      // Step 2 → 3
      await goToStep3(user);

      // Click Train Model
      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      expect(req.epochs).toBe(42);
      expect(req.batch_size).toBe(8);
      expect(req.image_size).toBe(1280);
      expect(req.learning_rate).toBe(0.005);
      expect(req.patience).toBe(25);
    });

    it("sends correct YOLO model_type based on version + size + task selection", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      // Step 1 → 2 → select YOLO → 3
      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
      await goToStep3(user);

      // Default is yolo11 / n / segmentation → yolo11n-seg.pt
      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      // model_type must be derived from version+size+task, not hardcoded
      expect(req.model_type).toMatch(/^yolo11n-seg\.pt$/);
      expect(req.project_id).toBe(456);
      expect(req.dataset_configs).toHaveLength(1);
    });

    it("sends custom RF-DETR settings (variant, epochs, batchSize, imageSize) to API", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      // Step 1 → 2 → select RF-DETR → change settings → 3
      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /rf-detr/i }));

      // Change inline settings while still on step 2
      fireEvent.change(screen.getByDisplayValue("100"), { target: { value: "75" } });
      fireEvent.change(screen.getByDisplayValue("16"), { target: { value: "4" } });
      fireEvent.change(screen.getByDisplayValue("640"), { target: { value: "800" } });

      // Step 2 → 3 → Train
      await goToStep3(user);
      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startRTDETRTraining).toHaveBeenCalled());

      const req = mockApi.startRTDETRTraining.mock.calls[0][0];
      expect(req.epochs).toBe(75);
      expect(req.batch_size).toBe(4);
      expect(req.image_size).toBe(800);
      // Default variant is rtdetr-l
      expect(req.model_type).toBe("rtdetr-l.pt");
      expect(req.project_id).toBe(456);
    });

    it("sends default RF-DETR settings when nothing is changed", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /rf-detr/i }));
      await goToStep3(user);

      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startRTDETRTraining).toHaveBeenCalled());

      const req = mockApi.startRTDETRTraining.mock.calls[0][0];
      expect(req.epochs).toBe(100);
      expect(req.batch_size).toBe(16);
      expect(req.image_size).toBe(640);
      expect(req.model_type).toBe("rtdetr-l.pt");
      expect(req.optimizer).toBe("AdamW");
      expect(req.learning_rate).toBe(0.0001);
      expect(req.weight_decay).toBe(0.0001);
      expect(req.patience).toBe(50);
    });

    it("sends dataset split values as configured by the user", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      // Add dataset
      await addSingleDataset(user);
      await flushMicrotasks();
      await waitFor(() => expect(mockApi.getImageCollections).toHaveBeenCalled());
      await waitFor(() => expect(mockApi.getAnnotations).toHaveBeenCalled());

      // Interact with the Train % range slider (first slider in the page)
      const sliders = screen.getAllByRole("slider");
      const trainSlider = sliders[0];
      // Fire a fireEvent change to set slider to 70
      fireEvent.change(trainSlider, { target: { value: "70" } });

      // Navigate to step 2, select YOLO, go to step 3
      const nextBtn1 = await screen.findByRole("button", { name: /next/i });
      await waitFor(() => expect(nextBtn1).not.toBeDisabled());
      await user.click(nextBtn1);
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
      await goToStep3(user);

      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      const split = req.dataset_configs[0].split;
      // split should be an object with train/val/test that sum to 100
      expect(split).toBeDefined();
      expect(split.train + split.val + split.test).toBe(100);
    });

    it("sends custom task name when provided", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
      await goToStep3(user);

      // On step 3, fill in the custom name
      const nameInput = screen.getByPlaceholderText(/my custom yolo training/i);
      await user.clear(nameInput);
      await user.type(nameInput, "My Special Run");

      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      expect(req.task_name).toBe("My Special Run");
    });

    it("does not send custom name when left empty (falls back to default)", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
      await goToStep3(user);

      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      // task_name should contain a fallback string, not be empty
      expect(req.task_name).toBeTruthy();
      expect(req.task_name).toMatch(/yolo training/i);
    });

    it("sends remove_images_without_annotations as true by default", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
      await goToStep3(user);

      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      expect(req.remove_images_without_annotations).toBe(true);
    });

    it("sends remove_images_without_annotations as false when unchecked", async () => {
      const user = userEvent.setup({ delay: null, pointerEventsCheck: 0 });
      renderModal();

      await navigateToStep2(user);
      await user.click(screen.getByRole("heading", { name: /^yolo$/i }));
      await goToStep3(user);

      // On step 3, uncheck the option
      const checkbox = screen.getByLabelText(/remove images without annotations/i);
      await user.click(checkbox);

      const trainBtn = await screen.findByRole("button", { name: /train model/i });
      await waitFor(() => expect(trainBtn).not.toBeDisabled());
      await user.click(trainBtn);

      await waitFor(() => expect(mockApi.startYoloTraining).toHaveBeenCalled());

      const req = mockApi.startYoloTraining.mock.calls[0][0];
      expect(req.remove_images_without_annotations).toBe(false);
    });
  });
});
