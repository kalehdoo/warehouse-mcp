/**
 * Hard cap on tabular tool results to prevent agent loops from exhausting
 * memory or saturating the response stream.
 *
 * Limit is "cells" = rows × columns. A 100k-cell default lets a typical
 * agent see 1000 rows × 100 cols, or 10k rows × 10 cols, which covers
 * almost every real analytical question. When exceeded, rows are
 * truncated and `truncated: true` plus `original_row_count` are added
 * so the agent can react.
 *
 * Setting QUERY_MAX_RESULT_CELLS=0 disables the cap entirely.
 */

/**
 * @param {{rows: any[], columns: any[]} | any} result
 * @param {number} maxCells  Total cells allowed (rows.length * columns.length).
 * @returns {object}
 */
export function applyResultCap(result, maxCells) {
  if (!result || !Array.isArray(result.rows) || maxCells === 0) {
    return result;
  }
  const rowCount = result.rows.length;
  const colCount = Array.isArray(result.columns) ? result.columns.length : 1;
  const cells = rowCount * colCount;
  if (cells <= maxCells) {
    return result;
  }
  const allowedRows = Math.max(0, Math.floor(maxCells / Math.max(1, colCount)));
  return {
    ...result,
    rows: result.rows.slice(0, allowedRows),
    truncated: true,
    original_row_count: rowCount,
    cap_cells: maxCells,
  };
}
