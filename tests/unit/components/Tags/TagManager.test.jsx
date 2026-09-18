// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TagManager from '@/components/Tags/TagManager';

describe('TagManager', () => {
  beforeEach(() => {
    window.pixyang = {
      getTags: vi.fn().mockResolvedValue([
        { id: 5, name: '风景', color: '#818cf8', image_count: 6 },
        { id: 7, name: '人像', color: '#f472b6', image_count: 3 },
      ]),
      createTag: vi.fn().mockResolvedValue({ id: 9, name: '新标签', color: '#fbbf24' }),
      deleteTag: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('渲染标题与已有标签列表（含图片计数）', async () => {
    render(<TagManager onSelectTag={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.getByText('管理标签')).toBeInTheDocument();
    expect(await screen.findByText('风景')).toBeInTheDocument();
    expect(screen.getByText('人像')).toBeInTheDocument();
    expect(screen.getByText('6 张图片')).toBeInTheDocument();
    expect(screen.getByText('3 张图片')).toBeInTheDocument();
  });

  it('无标签时显示空态引导', async () => {
    window.pixyang.getTags.mockResolvedValue([]);
    render(<TagManager onSelectTag={vi.fn()} onRefresh={vi.fn()} />);
    expect(await screen.findByText('还没有标签')).toBeInTheDocument();
  });

  it('输入名称后点击创建：调用 createTag 并刷新列表', async () => {
    const onRefresh = vi.fn();
    render(<TagManager onSelectTag={vi.fn()} onRefresh={onRefresh} />);
    await screen.findByText('风景');
    const input = screen.getByPlaceholderText('输入新标签名称...');
    fireEvent.change(input, { target: { value: '新标签' } });
    // 创建前按钮禁用态已解除
    const createBtn = screen.getByText('创建标签');
    fireEvent.click(createBtn);
    await vi.waitFor(() => {
      expect(window.pixyang.createTag).toHaveBeenCalledWith('新标签', '#818cf8');
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('名称为空时创建按钮禁用', async () => {
    render(<TagManager onSelectTag={vi.fn()} onRefresh={vi.fn()} />);
    await screen.findByText('风景');
    expect(screen.getByText('创建标签')).toBeDisabled();
  });

  it('点击搜索图标回调 onSelectTag(tag.id)', async () => {
    const onSelectTag = vi.fn();
    render(<TagManager onSelectTag={onSelectTag} onRefresh={vi.fn()} />);
    await screen.findByText('风景');
    fireEvent.click(screen.getAllByTitle('按此标签筛选图片')[0]); // 每行都有同名按钮，取第一行
    expect(onSelectTag).toHaveBeenCalledWith(5);
  });

  it('点击删除图标弹出确认框，确认后调用 deleteTag', async () => {
    const onRefresh = vi.fn();
    render(<TagManager onSelectTag={vi.fn()} onRefresh={onRefresh} />);
    await screen.findByText('风景');
    fireEvent.click(screen.getAllByTitle('删除标签')[0]); // 每行都有同名按钮，取第一行
    // ConfirmDialog（radix AlertDialog 传送门）
    expect(await screen.findByText(/确定要删除标签/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('删除', { selector: 'button' }));
    await vi.waitFor(() => {
      expect(window.pixyang.deleteTag).toHaveBeenCalledWith(5);
      expect(onRefresh).toHaveBeenCalled();
    });
  });
});
