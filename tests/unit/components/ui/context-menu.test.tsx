// @vitest-environment happy-dom
// ContextMenu 冒烟：contextmenu 事件打开、item/checkbox/radio 交互、label/separator/shortcut、
// 子菜单、destructive/inset、Portal/Group/禁用 trigger。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

function MenuHarness(props: { onSelect?: (label: string) => void; disabledTrigger?: boolean }) {
  const [checked, setChecked] = React.useState(false);
  const [radio, setRadio] = React.useState('small');
  return (
    <ContextMenu>
      <ContextMenuTrigger
        disabled={props.disabledTrigger}
        className="my-trigger"
        data-testid="ctx-trigger"
      >
        右键区域
      </ContextMenuTrigger>
      <ContextMenuContent className="my-content">
        <ContextMenuGroup>
          <ContextMenuItem inset className="my-item" onSelect={() => props.onSelect?.('刷新')}>
            刷新<ContextMenuShortcut>F5</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => props.onSelect?.('移除')}>
            移除
          </ContextMenuItem>
          <ContextMenuCheckboxItem
            checked={checked}
            onCheckedChange={(c) => setChecked(Boolean(c))}
            onSelect={(e) => e.preventDefault()}
          >
            显示隐藏文件
          </ContextMenuCheckboxItem>
          <ContextMenuRadioGroup value={radio} onValueChange={setRadio}>
            <ContextMenuRadioItem value="small" onSelect={(e) => e.preventDefault()}>
              小图标
            </ContextMenuRadioItem>
            <ContextMenuRadioItem value="large" onSelect={(e) => e.preventDefault()}>
              大图标
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuLabel inset>排序方式</ContextMenuLabel>
        <ContextMenuPortal>
          <ContextMenuSub>
            <ContextMenuSubTrigger>新建</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem inset onSelect={() => props.onSelect?.('文件夹')}>
                文件夹
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuPortal>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const openMenu = (trigger: HTMLElement) => {
  // Radix ContextMenu Trigger 依赖原生 contextmenu 事件（右键）
  fireEvent.contextMenu(trigger);
};

describe('ui/ContextMenu', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('未打开时无菜单，trigger 渲染自定义 className 与 data-slot', () => {
    render(<MenuHarness />);
    const trigger = screen.getByTestId('ctx-trigger');
    expect(trigger).toHaveClass('my-trigger');
    expect(trigger).toHaveAttribute('data-slot', 'context-menu-trigger');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('contextmenu 事件打开：菜单、label/separator/shortcut 可见，属性正确', async () => {
    render(<MenuHarness />);
    const trigger = screen.getByTestId('ctx-trigger');
    openMenu(trigger);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveClass('my-content');
    expect(menu).toHaveAttribute('data-slot', 'context-menu-content');
    expect(screen.getByText('排序方式')).toBeInTheDocument();
    expect(screen.getByText('排序方式')).toHaveAttribute('data-inset', 'true');
    expect(document.querySelector('[data-slot="context-menu-separator"]')).toBeInTheDocument();
    expect(screen.getByText('F5')).toHaveAttribute('data-slot', 'context-menu-shortcut');
    expect(screen.getByText('刷新')).toHaveClass('my-item');
    expect(screen.getByText('刷新')).toHaveAttribute('data-inset', 'true');
    expect(screen.getByText('移除')).toHaveAttribute('data-variant', 'destructive');
  });

  it('点击普通 item：onSelect 触发且菜单自动关闭', async () => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    openMenu(screen.getByTestId('ctx-trigger'));
    fireEvent.click(await screen.findByText('刷新'));
    expect(onSelect).toHaveBeenCalledWith('刷新');
    await vi.waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('checkbox item：点击勾选，data-state 与指示器切换', async () => {
    render(<MenuHarness />);
    openMenu(screen.getByTestId('ctx-trigger'));
    const item = await screen.findByRole('menuitemcheckbox', { name: '显示隐藏文件' });
    expect(item).toHaveAttribute('data-state', 'unchecked');
    fireEvent.click(item);
    await vi.waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: '显示隐藏文件' })).toHaveAttribute(
        'data-state',
        'checked'
      );
    });
  });

  it('radio group：点击切换选中项', async () => {
    render(<MenuHarness />);
    openMenu(screen.getByTestId('ctx-trigger'));
    const large = await screen.findByRole('menuitemradio', { name: '大图标' });
    expect(screen.getByRole('menuitemradio', { name: '小图标' })).toHaveAttribute(
      'data-state',
      'checked'
    );
    fireEvent.click(large);
    await vi.waitFor(() => {
      expect(screen.getByRole('menuitemradio', { name: '大图标' })).toHaveAttribute(
        'data-state',
        'checked'
      );
    });
  });

  it('子菜单：点击 SubTrigger 展开，点击子项触发 onSelect', async () => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    openMenu(screen.getByTestId('ctx-trigger'));
    const subTrigger = await screen.findByText('新建');
    expect(subTrigger).toHaveAttribute('data-slot', 'context-menu-sub-trigger');
    fireEvent.click(subTrigger);
    fireEvent.click(await screen.findByText('文件夹'));
    expect(onSelect).toHaveBeenCalledWith('文件夹');
  });

  it('disabled trigger：contextmenu 事件不打开菜单', () => {
    render(<MenuHarness disabledTrigger />);
    const trigger = screen.getByTestId('ctx-trigger');
    expect(trigger).toHaveAttribute('data-disabled');
    openMenu(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
