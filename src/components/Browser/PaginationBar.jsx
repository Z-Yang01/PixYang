import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { totalPagesOf } from '@/lib/gallery';
import useGalleryStore from '@/store/galleryStore';

export default function PaginationBar() {
  const page = useGalleryStore((s) => s.page);
  const totalImages = useGalleryStore((s) => s.totalImages);
  const gridSettings = useGalleryStore((s) => s.gridSettings);
  const setPage = useGalleryStore((s) => s.setPage);
  const [pageInput, setPageInput] = useState(String(page));
  const totalPages = totalPagesOf(totalImages, gridSettings);

  useEffect(() => {
    setPageInput(String(page));
  }, [page]);

  const handlePageInputJump = () => {
    const n = parseInt(pageInput, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= totalPages) {
      setPage(n);
    } else {
      setPageInput(String(page));
    }
  };

  return (
    <div className="pagination-bar">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
        <ChevronLeft className="size-4" /> 上一页
      </Button>
      <div className="pagination-info">
        <span>第</span>
        <Input
          type="number"
          className="pagination-input"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handlePageInputJump();
          }}
          onBlur={handlePageInputJump}
        />
        <span>/ {totalPages} 页</span>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => setPage(page + 1)}
      >
        下一页 <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
