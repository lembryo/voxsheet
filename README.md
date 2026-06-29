# @lembryo/voxsheet

Voxel-style virtual spreadsheet renderer for the web.

Render millions of cells smoothly with DOM-based virtual scrolling.
React component, peer-dependency model, TypeScript-first.

## Installation

```bash
npm install @lembryo/voxsheet
# or
pnpm add @lembryo/voxsheet
```

## Usage

```tsx
import { VoxSheet } from '@lembryo/voxsheet';
import '@lembryo/voxsheet/styles.css';

async function fetchRows(offset: number, limit: number) {
  const res = await fetch(`/api/rows?offset=${offset}&limit=${limit}`);
  return res.json();
}

export function App() {
  return (
    <VoxSheet
      columns={['ID', 'Name', 'Email']}
      totalRows={1_000_000}
      fetchRows={fetchRows}
    />
  );
}
```

## License

MIT
