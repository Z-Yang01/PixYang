import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ListChecks,
  Download,
  Trash2,
  Tag,
  Star,
  Heart,
  X,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useGalleryStore from '@/store/galleryStore';
import api from '@/lib/api';
import builtinPresetsModule from '../../../shared/builtinPresets.cjs';

const { BUILTIN_PRESETS } = builtinPresetsModule;

// 与编辑器内置 chips 同构的预设形态（仅 name + 影调域；desc/orientation/crop/masks 不进批量链路）
function presetPayload(preset) {
  return {
    name: preset.name,
    basic: preset.basic,
    curves: preset.curves,
    colorGrading: preset.colorGrading,
    lens: preset.lens,
  };
}

export default function BatchBar({
  onClear,
  onBatchDelete,
  onSelectAllPage,
  onSelectAllAll,
  onExport,
  onBatchTag,
  onBatchUpdate,
  onSyncEdits,
  onApplyPreset,
  onAutoGrade,
}) {
  const selectedIds = useGalleryStore((s) => s.selectedIds);
  const totalCount = useGalleryStore((s) => s.totalImages);
  const tags = useGalleryStore((s) => s.tags);
  const hasCopiedEdits = useGalleryStore((s) => !!s.copiedEdits);
  const [userPresets, setUserPresets] = useState([]);

  // 打开预设下拉时现拉（而非挂载时拉一次）：BatchBar 在图库页常驻不重挂，
  // 编辑器里新存的预设不重拉就永远不出现
  const loadPresets = () => {
    if (!api.isBridgeAvailable()) return;
    api
      .getPresets()
      ?.then?.((list) => setUserPresets((list || []).filter((pr) => pr?.params?.basic)))
      .catch?.((e) => console.error('[batch] 预设加载失败:', e.message));
  };

  if (selectedIds.size === 0) return null;

  return (
    <div className="batch-bar">
      <span className="batch-bar-count">已选 {selectedIds.size} 张</span>

      <Button variant="secondary" size="sm" onClick={onSelectAllPage}>
        <ListChecks className="size-4" /> 全选本页
      </Button>
      <Button variant="secondary" size="sm" onClick={onSelectAllAll}>
        全选全部（{totalCount}）
      </Button>

      <div className="batch-bar-divider" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Tag className="size-4" /> 打标签
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {tags.length === 0 && (
            <DropdownMenuItem disabled>请先在「管理标签」中创建标签</DropdownMenuItem>
          )}
          {tags.map((tag) => (
            <DropdownMenuItem key={tag.id} onClick={() => onBatchTag?.(tag.id)}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
              {tag.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Star className="size-4" /> 评分
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {[5, 4, 3, 2, 1].map((n) => (
            <DropdownMenuItem key={n} onClick={() => onBatchUpdate?.({ rating: n })}>
              <span className="batch-rating-preview">
                {Array.from({ length: n }, (_, i) => (
                  <Star key={i} className="size-3" fill="currentColor" strokeWidth={0} />
                ))}
              </span>
              {n} 星
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onBatchUpdate?.({ rating: 0 })}>
            清除评分
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Heart className="size-4" /> 收藏
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onBatchUpdate?.({ favorite: 1 })}>
            设为收藏
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onBatchUpdate?.({ favorite: 0 })}>
            取消收藏
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="batch-bar-divider" />

      <Button variant="secondary" size="sm" onClick={onExport}>
        <Download className="size-4" /> 导出
      </Button>

      {hasCopiedEdits && onSyncEdits && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="sm"
              title="把复制的编辑参数同步到所选图片（只写参数，不写像素）"
            >
              <SlidersHorizontal className="size-4" /> 同步参数到所选
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onSyncEdits('basic')}>
              仅同步影调（推荐）
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSyncEdits('all')}>
              同步影调 + 旋转/翻转
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu onOpenChange={(open) => open && loadPresets()}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            title="把预设参数套用到所选图片（只写参数不写像素，保留各图裁剪/旋转）"
          >
            <Wand2 className="size-4" /> 应用预设
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            title="逐张分析画面直方图，自动设置影调（保留各图裁剪/旋转，可再手动微调）"
            onClick={() => onAutoGrade?.()}
          >
            自动调色（按画面分析）
          </DropdownMenuItem>
          {BUILTIN_PRESETS.map((bp) => (
            <DropdownMenuItem
              key={bp.name}
              title={bp.desc}
              onClick={() => onApplyPreset?.(presetPayload(bp))}
            >
              {bp.name}
            </DropdownMenuItem>
          ))}
          {userPresets.length > 0 && <DropdownMenuSeparator />}
          {userPresets.length > 0 && <DropdownMenuLabel>我的预设</DropdownMenuLabel>}
          {userPresets.map((pr) => (
            <DropdownMenuItem
              key={pr.id}
              onClick={() => onApplyPreset?.(presetPayload({ ...pr.params, name: pr.name }))}
            >
              {pr.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="batch-bar-divider" />

      <Button variant="destructive" size="sm" onClick={onBatchDelete}>
        <Trash2 className="size-4" /> 删除
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X className="size-4" /> 取消
      </Button>
    </div>
  );
}
