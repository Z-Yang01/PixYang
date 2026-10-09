import { memo } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Heart,
  Check,
  FolderPlus,
  FolderMinus,
  Eye,
  Pencil,
  Trash2,
  Images,
  ImageOff,
} from 'lucide-react';
import StarRating from '@/components/common/StarRating';

const ImageCard = memo(function ImageCard({
  image,
  index,
  selected,
  highlighted,
  tags,
  allTags,
  thumbSrc,
  originalSrc,
  thumbBroken,
  onClick,
  onCheckboxClick,
  onRate,
  onToggleFavorite,
  onQuickTag,
  onView,
  onInfo,
  onRename,
  onDelete,
  onAddToAlbum,
  onRemoveFromAlbum,
  onThumbError,
  onOriginalError,
}) {
  // 缩略图由后端按 EXIF 方向物理转正，竖图同样优先缩略图；缺失时回退原图（浏览器自动转正）
  const cardTransform =
    image.rotation || image.flip_h || image.flip_v
      ? `rotate(${image.rotation || 0}deg) scaleX(${image.flip_h ? -1 : 1}) scaleY(${image.flip_v ? -1 : 1})`
      : undefined;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-id={image.id}
          className={`image-card ${selected ? 'selected' : ''} ${highlighted ? 'keyboard-active' : ''}`}
          onClick={(e) => onClick(image, index, e)}
        >
          {image.favorite ? (
            <Heart className="favorite-heart" fill="currentColor" strokeWidth={1.5} />
          ) : null}
          <span
            className={`card-checkbox ${selected ? 'checked' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onCheckboxClick(image, e);
            }}
          >
            {selected && <Check className="size-3" />}
          </span>

          {thumbSrc && !thumbBroken ? (
            <img
              className="image-card-thumb"
              src={thumbSrc}
              alt={image.filename}
              loading="lazy"
              decoding="async"
              style={{ transform: cardTransform }}
              onError={() => onThumbError(image.id)}
            />
          ) : originalSrc ? (
            <img
              className="image-card-thumb"
              src={originalSrc}
              alt={image.filename}
              loading="lazy"
              decoding="async"
              style={{ transform: cardTransform }}
              onError={() => onOriginalError(image.id)}
            />
          ) : (
            <div className="image-card-placeholder">
              <ImageOff className="size-6" />
              <span>{image.format?.toUpperCase() || 'IMAGE'}</span>
            </div>
          )}

          <div className="image-card-info">
            <div className="image-card-name" title={image.filename}>
              {image.filename.replace(/\.\w+$/, '')}
            </div>
            <div className="card-tag-row">
              {tags.slice(0, 3).map((tag) => (
                <span key={tag.id} className="card-tag" title={tag.name}>
                  <span className="card-tag-dot" style={{ background: tag.color }} />
                  {tag.name}
                </span>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="card-tag card-tag-add"
                    title="添加或移除标签"
                    onClick={(e) => e.stopPropagation()}
                  >
                    +标签
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>点击添加/移除标签</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {allTags.length === 0 && (
                    <DropdownMenuItem disabled>请先在「管理标签」中创建标签</DropdownMenuItem>
                  )}
                  {allTags.map((tag) => {
                    const active = tags.find((t) => t.id === tag.id);
                    return (
                      <DropdownMenuItem
                        key={tag.id}
                        onClick={(e) => onQuickTag(image.id, tag.id, e)}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: tag.color,
                          }}
                        />
                        {tag.name}
                        {active && <Check className="ml-auto size-3" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="image-card-meta">
              {image.taken_at && <span className="card-date">{image.taken_at}</span>}
              {!image.taken_at && image.import_date && (
                <span className="card-date">{image.import_date}</span>
              )}
            </div>
          </div>
          <div className="card-stars">
            <StarRating
              rating={image.rating || 0}
              interactive
              stopPropagation
              onChange={(r) => onRate(image, r)}
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onView(image, index)}>
          <Eye className="size-4" /> 查看大图
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onInfo(image)}>
          <Images className="size-4" /> 查看详情
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onRename(image)}>
          <Pencil className="size-4" /> 编辑名称
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onToggleFavorite(image)}>
          <Heart className="size-4" fill={image.favorite ? 'currentColor' : 'none'} />
          {image.favorite ? '取消收藏' : '收藏'}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAddToAlbum(image)}>
          <FolderPlus className="size-4" /> 添加到相册...
        </ContextMenuItem>
        {onRemoveFromAlbum && (
          <ContextMenuItem onClick={() => onRemoveFromAlbum(image.id)}>
            <FolderMinus className="size-4" /> 移出相册
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive" onClick={() => onDelete(image)}>
          <Trash2 className="size-4" /> 删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export default ImageCard;
