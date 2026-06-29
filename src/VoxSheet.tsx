import { useEffect, useRef, useState, useCallback } from 'react';
import type { VoxSheetProps, FetchResult } from './types';
import './VoxSheet.css';

const DEFAULT_ROW_HEIGHT = 28;
const DEFAULT_COLUMN_WIDTH = 120;
const OVERSCAN = 10;

/**
 * VoxSheet — DOM ベースの仮想スクロール対応スプレッドシート。
 *
 * このコンポーネントは骨組みのみ。実装は CSV Zero の VirtualSpreadsheet から
 * 段階的に移植する想定。
 */
export function VoxSheet(props: VoxSheetProps) {
  const {
    columns,
    totalRows,
    fetchRows,
    rowHeight = DEFAULT_ROW_HEIGHT,
    defaultColumnWidth = DEFAULT_COLUMN_WIDTH,
    readOnly = false,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [chunk, setChunk] = useState<FetchResult | null>(null);
  const [chunkOffset, setChunkOffset] = useState(0);

  // ビューポート高さの追従
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 可視範囲の計算
  const visibleStart = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const visibleEnd = Math.min(
    totalRows,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN,
  );

  // データ取得
  useEffect(() => {
    let cancelled = false;
    const limit = visibleEnd - visibleStart;
    if (limit <= 0) return;
    fetchRows(visibleStart, limit).then((result) => {
      if (!cancelled) {
        setChunk(result);
        setChunkOffset(visibleStart);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visibleStart, visibleEnd, fetchRows]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = totalRows * rowHeight;
  const offsetY = visibleStart * rowHeight;

  return (
    <div
      ref={containerRef}
      className="voxsheet-container"
      role="grid"
      aria-rowcount={totalRows}
      aria-colcount={columns.length}
      aria-readonly={readOnly}
      onScroll={handleScroll}
    >
      <div className="voxsheet-header" role="row">
        {columns.map((col, i) => (
          <div
            key={i}
            className="voxsheet-header-cell"
            role="columnheader"
            style={{ width: defaultColumnWidth }}
          >
            {col}
          </div>
        ))}
      </div>
      <div className="voxsheet-scroll" style={{ height: totalHeight }}>
        <div
          className="voxsheet-rows"
          style={{ transform: `translateY(${offsetY}px)` }}
        >
          {chunk &&
            chunk.data.map((row, i) => (
              <div
                key={chunk.ids[i] ?? chunkOffset + i}
                className="voxsheet-row"
                role="row"
                style={{ height: rowHeight }}
              >
                {row.map((cell, j) => (
                  <div
                    key={j}
                    className="voxsheet-cell"
                    role="gridcell"
                    style={{ width: defaultColumnWidth }}
                  >
                    {cell}
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
