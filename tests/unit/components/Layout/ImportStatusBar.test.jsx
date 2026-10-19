// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImportStatusBar from '@/components/Layout/ImportStatusBar';
import { useImportStore } from '@/store/importStore';

function setState(partial) {
  useImportStore.setState(partial);
}

describe('ImportStatusBar', () => {
  beforeEach(() => {
    useImportStore.setState({ active: null, queue: [], finished: null });
  });

  afterEach(cleanup);

  it('空闲：不渲染', () => {
    const { container } = render(<ImportStatusBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('进行中：显示进度、当前文件、EXIF 细分与排队数；进度条宽度按批推进', () => {
    setState({
      active: {
        id: 1,
        total: 40,
        attempted: 20,
        imported: 18,
        skipped: 2,
        currentFile: 'IMG_0001.jpg',
        exif: { done: 12, total: 20 },
        status: 'running',
      },
      queue: [{ id: 2 }, { id: 3 }],
    });
    render(<ImportStatusBar />);
    expect(screen.getByText(/正在导入 18\/40/)).toBeInTheDocument();
    expect(screen.getByText(/（50%）/)).toBeInTheDocument();
    expect(screen.getByText(/另有 2 批排队/)).toBeInTheDocument();
    expect(screen.getByText(/IMG_0001\.jpg/)).toBeInTheDocument();
    expect(screen.getByText(/读取信息 12\/20/)).toBeInTheDocument();
    expect(document.querySelector('.progress-bar-fill').style.width).toBe('50%');
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled();
  });

  it('取消中：文案切换且停止按钮禁用', () => {
    setState({
      active: {
        id: 1,
        total: 20,
        attempted: 20,
        imported: 20,
        skipped: 0,
        currentFile: 'a.jpg',
        exif: null,
        status: 'canceling',
      },
      queue: [],
    });
    render(<ImportStatusBar />);
    expect(screen.getByText(/正在停止导入/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
  });

  it('点停止：调用 requestCancel', () => {
    setState({
      active: {
        id: 1,
        total: 20,
        attempted: 0,
        imported: 0,
        skipped: 0,
        currentFile: 'a.jpg',
        exif: null,
        status: 'running',
      },
      queue: [],
    });
    render(<ImportStatusBar />);
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(useImportStore.getState().active.status).toBe('canceling');
  });

  it('完成态：成功/跳过/剩余摘要与关闭按钮', () => {
    setState({
      active: null,
      finished: { total: 30, imported: 25, skipped: 3, left: 2, canceled: true, error: '' },
    });
    render(<ImportStatusBar />);
    expect(screen.getByText('已停止导入')).toBeInTheDocument();
    expect(screen.getByText(/成功 25 张/)).toBeInTheDocument();
    expect(screen.getByText(/跳过 3 张/)).toBeInTheDocument();
    expect(screen.getByText(/剩余 2 张未导入/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(useImportStore.getState().finished).toBeNull();
  });

  it('错误态：展示错误文案', () => {
    setState({
      active: null,
      finished: { total: 2, imported: 0, skipped: 2, canceled: false, error: '磁盘已满' },
    });
    render(<ImportStatusBar />);
    expect(screen.getByText('导入出现错误')).toBeInTheDocument();
    expect(screen.getByText('磁盘已满')).toBeInTheDocument();
  });
});
