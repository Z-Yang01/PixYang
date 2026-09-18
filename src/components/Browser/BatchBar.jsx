import { Button } from '@/components/ui/button';
import {
  ListChecks, Download, Trash2, Tag, Star, Heart, X, SlidersHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useGalleryStore from '@/store/galleryStore';

export default function BatchBar({
  onClear, onBatchDelete,
  onSelectAllPage, onSelectAllAll, onExport,
  onBatchTag, onBatchUpdate, onSyncEdits,
}) {
  const selectedIds = useGalleryStore(s => s.selectedIds);
  const totalCount = useGalleryStore(s => s.totalImages);
  const tags = useGalleryStore(s => s.tags);
  const hasCopiedEdits = useGalleryStore(s => !!s.copiedEdits);

  if (selectedIds.size === 0) return null;

  return (
    <div className="batch-bar">
      <span className="batch-bar-count">已选 {selectedIds.size} 张</span>

      <Button variant="secondary" size="sm" onClick={onSelectAllPage}><ListChecks className="size-4" /> 全选本页</Button>
      <Button variant="secondary" size="sm" onClick={onSelectAllAll}>全选全部（{totalCount}）</Button>

      <div className="batch-bar-divider" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm"><Tag className="size-4" /> 打标签</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {tags.length === 0 && <DropdownMenuItem disabled>请先在「管理标签」中创建标签</DropdownMenuItem>}
          {tags.map(tag => (
            <DropdownMenuItem key={tag.id} onClick={() => onBatchTag?.(tag.id)}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
              {tag.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm"><Star className="size-4" /> 评分</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {[5, 4, 3, 2, 1].map(n => (
            <DropdownMenuItem key={n} onClick={() => onBatchUpdate?.({ rating: n })}>
              <span style={{ color: 'var(--star)', letterSpacing: 1 }}>{'★'.repeat(n)}</span>
              {n} 星
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onBatchUpdate?.({ rating: 0 })}>清除评分</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm"><Heart className="size-4" /> 收藏</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onBatchUpdate?.({ favorite: 1 })}>设为收藏</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onBatchUpdate?.({ favorite: 0 })}>取消收藏</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="batch-bar-divider" />

      <Button variant="secondary" size="sm" onClick={onExport}><Download className="size-4" /> 导出</Button>

      {hasCopiedEdits && onSyncEdits && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" title="把复制的编辑参数同步到所选图片（只写参数，不写像素）">
              <SlidersHorizontal className="size-4" /> 同步参数到所选
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onSyncEdits('basic')}>仅同步影调（推荐）</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSyncEdits('all')}>同步影调 + 旋转/翻转</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="batch-bar-divider" />

      <Button variant="destructive" size="sm" onClick={onBatchDelete}><Trash2 className="size-4" /> 删除</Button>
      <Button variant="ghost" size="sm" onClick={onClear}><X className="size-4" /> 取消</Button>
    </div>
  );
}
