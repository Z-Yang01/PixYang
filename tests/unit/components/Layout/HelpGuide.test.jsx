// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import HelpGuide from '@/components/Layout/HelpGuide';

afterEach(() => cleanup());

describe('HelpGuide（使用说明）', () => {
  it('关闭状态不渲染', () => {
    const { container } = render(<HelpGuide open={false} onClose={() => {}} />);
    expect(container.querySelector('.dialog-backdrop')).toBeNull();
  });

  it('打开后渲染六大功能分区', () => {
    render(<HelpGuide open onClose={() => {}} />);
    for (const title of ['图库浏览', '导入图片', '编辑图片', '标签与相册', '数据与维护', '快捷键']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('点遮罩与 X 都回调 onClose', () => {
    const onClose = vi.fn();
    const { container } = render(<HelpGuide open onClose={onClose} />);
    fireEvent.click(container.querySelector('.dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('关闭'));
    expect(onClose).toHaveBeenCalledTimes(2);
    // 弹层内部点击不关闭
    fireEvent.click(screen.getByText('使用说明'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
