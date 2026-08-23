import React from 'react';
import { Button } from '@/components/ui/button';
import { CheckSquare, Download, Trash2 } from 'lucide-react';

export default function BatchBar({
  selectedIds, onClear, onBatchDelete,
  onSelectAllPage, onSelectAllAll, totalCount = 0, onExport,
}) {
  if (selectedIds.size === 0) return null;

  return (
    <div className="batch-bar">
      <span className="batch-bar-count">已选 {selectedIds.size} 张</span>

      <Button variant="secondary" size="sm" onClick={onSelectAllPage}><CheckSquare className="size-4" /> 全选本页</Button>
      <Button variant="secondary" size="sm" onClick={onSelectAllAll}>全选全部（{totalCount}）</Button>

      <div className="batch-bar-divider" />

      <Button variant="secondary" size="sm" onClick={onExport}><Download className="size-4" /> 导出</Button>

      <div className="batch-bar-divider" />

      <Button variant="destructive" size="sm" onClick={onBatchDelete}><Trash2 className="size-4" /> 删除</Button>
      <Button variant="ghost" size="sm" onClick={onClear}>取消</Button>
    </div>
  );
}
