import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectCard } from '../../components/ProjectCard';
import { BrowserRouter } from 'react-router-dom';

const mockProject = {
  id: 1,
  name: 'Test Project',
  description: 'Test Description',
  tags: ['test'],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  datasets: [],
  logo_url: null,
  is_project: true
};

// Wrap component with necessary providers
const renderProjectCard = (props = {}) => {
  return render(
    <BrowserRouter>
      <ProjectCard
        project={mockProject}
        {...props}
      />
    </BrowserRouter>
  );
};

describe('ProjectCard', () => {
  it('renders project information correctly', () => {
    renderProjectCard();
    
    expect(screen.getByText('Test Project')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('opens edit dialog when edit option is clicked', async () => {
    const user = userEvent.setup();
    renderProjectCard();
    
    // Open dropdown menu
    const menuButton = screen.getByRole('button', { name: /more/i });
    await user.click(menuButton);
    
    // Click edit option
    const editButton = screen.getByText('Edit');
    await user.click(editButton);
    
    // Verify edit dialog is open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('Edit Project');
  });

  it('shows delete confirmation when delete option is clicked', async () => {
    const user = userEvent.setup();
    renderProjectCard();
    
    // Open dropdown menu
    const menuButton = screen.getByRole('button', { name: /more/i });
    await user.click(menuButton);
    
    // Click delete option
    const deleteButton = screen.getByText('Delete');
    await user.click(deleteButton);
    
    // Verify delete confirmation dialog is open
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure/i)).toBeInTheDocument();
  });

  it('calls onDelete when project deletion is confirmed', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    renderProjectCard({ onDelete });
    
    // Open dropdown menu
    const menuButton = screen.getByRole('button', { name: /more/i });
    await user.click(menuButton);
    
    // Click delete option
    const deleteButton = screen.getByText('Delete');
    await user.click(deleteButton);
    
    // Confirm deletion
    const confirmButton = screen.getByRole('button', { name: /delete/i });
    await user.click(confirmButton);
    
    // Wait for deletion and callback
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalled();
    });
  });

  it('calls onUpdate when project is edited', async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    renderProjectCard({ onUpdate });
    
    // Open dropdown menu
    const menuButton = screen.getByRole('button', { name: /more/i });
    await user.click(menuButton);
    
    // Click edit option
    const editButton = screen.getByText('Edit');
    await user.click(editButton);
    
    // Update project name
    const nameInput = screen.getByLabelText(/project name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'Updated Project');
    
    // Save changes
    const saveButton = screen.getByRole('button', { name: /save changes/i });
    await user.click(saveButton);
    
    // Wait for update and callback
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Updated Project'
      }));
    });
  });

  it('handles project duplication', async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    renderProjectCard({ onUpdate });
    
    // Open dropdown menu
    const menuButton = screen.getByRole('button', { name: /more/i });
    await user.click(menuButton);
    
    // Click duplicate option
    const duplicateButton = screen.getByText('Duplicate');
    await user.click(duplicateButton);
    
    // Wait for duplication and callback
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Test Project (Copy)'
      }));
    });
  });
});