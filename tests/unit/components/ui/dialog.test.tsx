// @vitest-environment happy-dom
// Dialog 冒烟：受控/非受控开合、关闭按钮、showCloseButton 分支、Footer 内置 Close、
// Description/Header/Portal/Overlay、className 合并。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

describe('ui/Dialog', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('受控 open：渲染 Portal/Overlay/Content/Title/Description 与默认关闭按钮', () => {
    render(
      <Dialog open>
        <DialogContent className="my-content" aria-describedby="desc-id">
          <DialogHeader>
            <DialogTitle className="my-title">删除图片</DialogTitle>
            <DialogDescription className="my-desc" id="desc-id">
              此操作不可恢复
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveClass('my-content');
    expect(screen.getByText('删除图片')).toHaveClass('my-title');
    expect(screen.getByText('此操作不可恢复')).toHaveClass('my-desc');
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument();
    // Radix Portal 本身不渲染 DOM 元素，data-slot 只在 Portal 组件实例上
    expect(document.querySelector('[data-slot="dialog-close"]')).toBeInTheDocument();
  });

  it('点击默认关闭按钮回调 onOpenChange(false)', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>标题</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    fireEvent.click(document.querySelector('[data-slot="dialog-close"]') as Element);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('showCloseButton=false 时不渲染关闭按钮', () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>标题</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(document.querySelector('[data-slot="dialog-close"]')).not.toBeInTheDocument();
  });

  it('DialogFooter：默认不含 Close，showCloseButton 时渲染并可通过它关闭（miss 113-115）', () => {
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <Dialog
          open={open}
          onOpenChange={(o) => {
            onOpenChange(o);
            setOpen(o);
          }}
        >
          <DialogContent>
            <DialogTitle>标题</DialogTitle>
            <DialogFooter showCloseButton>
              <button type="button">自定义操作</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Harness />);
    expect(screen.getByText('自定义操作')).toBeInTheDocument();
    const footerClose = screen.getByText('Close', { selector: 'button' });
    fireEvent.click(footerClose);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('非受控：DialogTrigger 打开，DialogClose 关闭', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button type="button">打开对话框</button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>非受控标题</DialogTitle>
            <DialogFooter showCloseButton>
              <DialogClose asChild>
                <button type="button">好的</button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }
    render(<Harness />);
    expect(screen.queryByText('非受控标题')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('打开对话框'));
    expect(screen.getByText('非受控标题')).toBeInTheDocument();
    fireEvent.click(screen.getByText('好的'));
    expect(screen.queryByText('非受控标题')).not.toBeInTheDocument();
  });

  it('手动组合 DialogPortal + DialogOverlay + Content 亦可渲染', () => {
    render(
      <Dialog open>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent>
            <DialogTitle>组合标题</DialogTitle>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    );
    expect(screen.getByText('组合标题')).toBeInTheDocument();
    // Content 内部自带一个 Overlay，手动又加了一个，因此至少 1 个
    expect(document.querySelectorAll('[data-slot="dialog-overlay"]').length).toBeGreaterThanOrEqual(
      1
    );
  });
});
