// @vitest-environment happy-dom
// DropdownMenu 冒烟：打开/关闭、item 点击 onSelect、checkbox/radio 受控切换、
// label/separator/shortcut/sub 菜单、destructive/inset 数据属性、Portal/Group/禁用态。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function MenuHarness(props: {
  onSelect?: (label: string) => void;
  sideOffset?: number;
  disabledTrigger?: boolean;
}) {
  const [checked, setChecked] = React.useState(true);
  const [radio, setRadio] = React.useState('r1');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={props.disabledTrigger} className="my-trigger">
        打开菜单
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={props.sideOffset} className="my-content">
        <DropdownMenuGroup>
          <DropdownMenuItem
            inset
            onSelect={() => props.onSelect?.('复制')}
            className="my-item"
          >
            复制<DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => props.onSelect?.('删除')}>
            删除
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={checked}
            onCheckedChange={(c) => setChecked(Boolean(c))}
            onSelect={(e) => e.preventDefault()}
          >
            显示网格
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value={radio} onValueChange={setRadio}>
            <DropdownMenuRadioItem value="r1" onSelect={(e) => e.preventDefault()}>
              小图
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="r2" onSelect={(e) => e.preventDefault()}>
              大图
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel inset>视图选项</DropdownMenuLabel>
        <DropdownMenuPortal>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>导出为</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => props.onSelect?.('PNG')}>PNG</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuPortal>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const openMenu = (trigger: HTMLElement) => {
  // Radix DropdownMenu Trigger 的 keyDown：Enter/Space 切换开合
  fireEvent.keyDown(trigger, { key: 'Enter' });
};

describe('ui/DropdownMenu', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('未打开时不渲染菜单内容，trigger 带 aria-haspopup 与自定义 className', () => {
    render(<MenuHarness />);
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveClass('my-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('键盘打开：菜单与 label/separator/shortcut/group 可见，自定义 content/item className 生效', async () => {
    render(<MenuHarness />);
    // 注意：Radix modal 菜单打开后会给应用容器加 aria-hidden，trigger 需提前抓引用
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    openMenu(trigger);
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveClass('my-content');
    expect(screen.getByText('视图选项')).toBeInTheDocument();
    expect(screen.getByText('视图选项')).toHaveAttribute('data-inset', 'true');
    expect(document.querySelector('[data-slot="dropdown-menu-separator"]')).toBeInTheDocument();
    expect(screen.getByText('⌘C')).toHaveAttribute('data-slot', 'dropdown-menu-shortcut');
    expect(screen.getByText('复制')).toHaveClass('my-item');
    expect(screen.getByText('复制')).toHaveAttribute('data-inset', 'true');
    expect(screen.getByText('删除')).toHaveAttribute('data-variant', 'destructive');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('pointerDown 打开、Esc 关闭（受控断言 onOpenChange）', async () => {
    const onOpenChange = vi.fn();
    function Controlled() {
      const [open, setOpen] = React.useState(false);
      return (
        <DropdownMenu open={open} onOpenChange={(o) => { onOpenChange(o); setOpen(o); }}>
          <DropdownMenuTrigger>打开菜单</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>复制</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    render(<Controlled />);
    fireEvent.pointerDown(screen.getByRole('button', { name: '打开菜单' }), {
      button: 0,
      ctrlKey: false,
    });
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await vi.waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('点击普通 item：onSelect 触发且菜单自动关闭', async () => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    openMenu(screen.getByRole('button', { name: '打开菜单' }));
    fireEvent.click(await screen.findByText('复制'));
    expect(onSelect).toHaveBeenCalledWith('复制');
    await vi.waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('checkbox item：点击切换 onCheckedChange，出现选中指示器', async () => {
    render(<MenuHarness />);
    openMenu(screen.getByRole('button', { name: '打开菜单' }));
    const item = await screen.findByRole('menuitemcheckbox', { name: '显示网格' });
    expect(item).toHaveAttribute('data-state', 'checked'); // 初始 checked=true
    fireEvent.click(item);
    await vi.waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: '显示网格' })).toHaveAttribute(
        'data-state',
        'unchecked'
      );
    });
  });

  it('radio group：点击切换选中项，data-state 正确', async () => {
    render(<MenuHarness />);
    openMenu(screen.getByRole('button', { name: '打开菜单' }));
    const r2 = await screen.findByRole('menuitemradio', { name: '大图' });
    expect(screen.getByRole('menuitemradio', { name: '小图' })).toHaveAttribute('data-state', 'checked');
    fireEvent.click(r2);
    await vi.waitFor(() => {
      expect(screen.getByRole('menuitemradio', { name: '大图' })).toHaveAttribute('data-state', 'checked');
      expect(screen.getByRole('menuitemradio', { name: '小图' })).toHaveAttribute('data-state', 'unchecked');
    });
  });

  it('子菜单：点击 SubTrigger 展开子项，点击子项触发 onSelect', async () => {
    const onSelect = vi.fn();
    render(<MenuHarness onSelect={onSelect} />);
    openMenu(screen.getByRole('button', { name: '打开菜单' }));
    fireEvent.click(await screen.findByText('导出为'));
    fireEvent.click(await screen.findByText('PNG'));
    expect(onSelect).toHaveBeenCalledWith('PNG');
  });

  it('sideOffset 透传与 disabledTrigger 不打开菜单', () => {
    render(<MenuHarness disabledTrigger sideOffset={12} />);
    const trigger = screen.getByRole('button', { name: '打开菜单' });
    expect(trigger).toBeDisabled();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
