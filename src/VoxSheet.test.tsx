import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoxSheet } from './VoxSheet';
import type { FetchResult } from './types';

describe('VoxSheet', () => {
  it('renders column headers', () => {
    const fetchRows = vi.fn().mockResolvedValue({
      data: [],
      ids: [],
      ordinals: [],
    } satisfies FetchResult);

    render(<VoxSheet columns={['A', 'B', 'C']} totalRows={0} fetchRows={fetchRows} />);

    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'C' })).toBeInTheDocument();
  });

  it('has correct aria-rowcount', () => {
    const fetchRows = vi.fn().mockResolvedValue({
      data: [],
      ids: [],
      ordinals: [],
    } satisfies FetchResult);

    render(<VoxSheet columns={['A']} totalRows={1_000_000} fetchRows={fetchRows} />);

    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '1000000');
  });
});
