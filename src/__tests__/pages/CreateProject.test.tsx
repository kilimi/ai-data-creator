import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import CreateProject from '../../pages/CreateProject';

const mockNavigate = vi.fn();

// Mock React Router hooks
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

// Wrap component with necessary providers
const renderCreateProject = () => {
  return render(
    <BrowserRouter>
      <CreateProject />
    </BrowserRouter>
  );
};

describe('CreateProject', () => {
  it('renders create project form', () => {
    renderCreateProject();
    
    expect(screen.getByText('Create New Project')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByText(/create a new project/i)).toBeInTheDocument();
  });

  it('validates required fields', async () => {
    const user = userEvent.setup();
    renderCreateProject();
    
    // Try to submit without filling required fields
    const submitButton = screen.getByRole('button', { name: /create/i });
    await user.click(submitButton);
    
    // Check for error message
    expect(screen.getByText(/please enter a name/i)).toBeInTheDocument();
  });

  it('handles project creation successfully', async () => {
    const user = userEvent.setup();
    renderCreateProject();
    
    // Fill out the form
    const nameInput = screen.getByLabelText(/name/i);
    const descriptionInput = screen.getByLabelText(/description/i);
    
    await user.type(nameInput, 'Test Project');
    await user.type(descriptionInput, 'Test Description');
    
    // Add a tag
    const tagInput = screen.getByPlaceholderText(/add tag/i);
    await user.type(tagInput, 'test{Enter}');
    
    // Submit the form
    const submitButton = screen.getByRole('button', { name: /create/i });
    await user.click(submitButton);
    
    // Wait for success and navigation
    await waitFor(() => {
      expect(screen.getByText(/has been created successfully/i)).toBeInTheDocument();
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('handles logo upload', async () => {
    const user = userEvent.setup();
    renderCreateProject();
    
    // Create a test file
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    
    // Get file input and upload area
    const fileInput = screen.getByLabelText(/project logo/i);
    
    // Upload file
    await user.upload(fileInput, file);
    
    // Check if file preview is shown
    expect(screen.getByAltText(/logo preview/i)).toBeInTheDocument();
  });

  it('handles form submission with all fields', async () => {
    const user = userEvent.setup();
    renderCreateProject();
    
    // Fill out all fields
    const nameInput = screen.getByLabelText(/name/i);
    const descriptionInput = screen.getByLabelText(/description/i);
    const tagInput = screen.getByPlaceholderText(/add tag/i);
    const file = new File(['test'], 'test.png', { type: 'image/png' });
    const fileInput = screen.getByLabelText(/project logo/i);
    
    await user.type(nameInput, 'Complete Project');
    await user.type(descriptionInput, 'Full Description');
    await user.type(tagInput, 'tag1{Enter}');
    await user.type(tagInput, 'tag2{Enter}');
    await user.upload(fileInput, file);
    
    // Submit form
    const submitButton = screen.getByRole('button', { name: /create/i });
    await user.click(submitButton);
    
    // Wait for success and navigation
    await waitFor(() => {
      expect(screen.getByText(/has been created successfully/i)).toBeInTheDocument();
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });
});