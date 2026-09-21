// @vitest-environment happy-dom
// AlertDialog 冒烟：Trigger 打开（miss 13-19）、Action/Cancel（miss 129-143）、
// size 分支、Media/Header/Description、Portal/Overlay。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

describe('ui/AlertDialog', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('非受控：AlertDialogTrigger 打开对话框（覆盖 Trigger 渲染）', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <button type="button">删除图片</button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>删除后无法恢复</AlertDialogDescription>
            </AlertDialogHeader>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    render(<Harness />);
    expect(screen.queryByText('确认删除')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('删除图片'));
    expect(screen.getByText('确认删除')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('删除后无法恢复')).toBeInTheDocument();
    // Overlay / Content 已挂载（Portal 组件本身不渲染 DOM）
    expect(document.querySelector('[data-slot="alert-dialog-overlay"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="alert-dialog-content"]')).toBeInTheDocument();
  });

  it('AlertDialogAction：点击回调 onClick 并关闭对话框（miss 129-143）', () => {
    const onAction = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogFooter>
              <AlertDialogAction onClick={onAction} className="my-action">
                确认
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    render(<Harness />);
    const action = screen.getByText('确认');
    expect(action).toHaveClass('my-action');
    expect(action.closest('[data-slot="alert-dialog-action"]')).toBeInTheDocument();
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('AlertDialogCancel：点击回调 onClick 并关闭；variant 透传给 Button', () => {
    const onCancel = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={onCancel} variant="secondary">
                取消
              </AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    }
    render(<Harness />);
    const cancel = screen.getByText('取消');
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('size=sm 时 data-size=sm，默认为 default；Media 渲染', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia data-testid="media">
              <svg />
            </AlertDialogMedia>
            <AlertDialogTitle>提示</AlertDialogTitle>
          </AlertDialogHeader>
        </AlertDialogContent>
      </AlertDialog>
    );
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-size', 'sm');
    expect(screen.getByTestId('media')).toHaveAttribute('data-slot', 'alert-dialog-media');
  });

  it('默认 size=default 与手动 Portal/Overlay 组合渲染', () => {
    render(
      <AlertDialog open>
        <AlertDialogPortal>
          <AlertDialogOverlay />
          <AlertDialogContent>
            <AlertDialogTitle>默认尺寸</AlertDialogTitle>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    );
    expect(screen.getByRole('alertdialog')).toHaveAttribute('data-size', 'default');
    // Content 内部自带一个 Overlay，手动又加了一个，因此至少 1 个
    expect(
      document.querySelectorAll('[data-slot="alert-dialog-overlay"]').length
    ).toBeGreaterThanOrEqual(1);
  });
});
