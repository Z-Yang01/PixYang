// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '@/components/Layout/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('渲染标题、消息与默认确认按钮', () => {
    render(
      <ConfirmDialog title="删除图片" message="确定吗？" onConfirm={vi.fn()} onCancel={vi.fn()} />
    );
    expect(screen.getByText('删除图片')).toBeInTheDocument();
    expect(screen.getByText('确定吗？')).toBeInTheDocument();
    expect(screen.getByText('确认')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('自定义 confirmLabel 生效', () => {
    render(
      <ConfirmDialog
        title="T"
        message="M"
        confirmLabel="删除 3 张"
        danger
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('删除 3 张')).toBeInTheDocument();
  });

  it('点击确认回调 onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="T" message="M" onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('确认'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('确认时 radix 关闭不再补发 onCancel（审查批 6 K13）', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="T" message="M" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('确认'));
    // Action 点击会同时触发 onOpenChange(false)：确认路径必须吞掉它，否则 onConfirm 的副作用被 onCancel 抵消
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('点击取消回调 onCancel（onClick 与 radix onOpenChange 双通道各触发一次，共 2 次）', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="T" message="M" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
