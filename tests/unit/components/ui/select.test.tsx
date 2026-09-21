// @vitest-environment happy-dom
// Select 冒烟：开/关、选项选择（受控值）、placeholder、禁用态、size、position 分支、
// Group/Label/Separator/ScrollButton 渲染。Radix Select 在 happy-dom 下用键盘事件驱动最稳。
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function SelectHarness(props: {
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  size?: 'sm' | 'default';
  position?: 'item-aligned' | 'popper';
  onValueChange?: (v: string) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}) {
  return (
    <Select
      value={props.value}
      defaultValue={props.defaultValue}
      disabled={props.disabled}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onValueChange={props.onValueChange}
    >
      <SelectTrigger size={props.size} className="my-trigger" aria-label="选择尺寸">
        <SelectValue placeholder="请选择" />
      </SelectTrigger>
      <SelectContent position={props.position}>
        <SelectGroup>
          <SelectLabel>分组一</SelectLabel>
          <SelectItem value="a">苹果</SelectItem>
          <SelectItem value="b" disabled>
            香蕉
          </SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="c">樱桃</SelectItem>
      </SelectContent>
    </Select>
  );
}

const openSelect = (trigger: HTMLElement) => {
  // Radix Select Trigger 的 OPEN_KEYS：Enter/Space/ArrowDown/ArrowUp
  fireEvent.keyDown(trigger, { key: 'Enter' });
};

describe('ui/Select', () => {
  beforeEach(() => {
    window.pixyang = { toFileUrl: vi.fn() };
  });
  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  it('初始渲染 trigger：placeholder 可见、data-size=default、自定义 className 生效', () => {
    render(<SelectHarness />);
    const trigger = screen.getByRole('combobox', { name: '选择尺寸' });
    expect(trigger).toHaveTextContent('请选择');
    expect(trigger).toHaveAttribute('data-size', 'default');
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger');
    expect(trigger).toHaveClass('my-trigger');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('size=sm 时 data-size=sm', () => {
    render(<SelectHarness size="sm" />);
    expect(screen.getByRole('combobox', { name: '选择尺寸' })).toHaveAttribute('data-size', 'sm');
  });

  it('disabled 时 trigger 带原生 disabled', () => {
    render(<SelectHarness disabled />);
    expect(screen.getByRole('combobox', { name: '选择尺寸' })).toBeDisabled();
  });

  it('defaultValue 时初始显示对应选项文本', () => {
    render(<SelectHarness defaultValue="a" />);
    expect(screen.getByRole('combobox', { name: '选择尺寸' })).toHaveTextContent('苹果');
  });

  it('键盘打开：出现选项列表、分组标签与分隔线', async () => {
    render(<SelectHarness />);
    openSelect(screen.getByRole('combobox', { name: '选择尺寸' }));
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '苹果' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '樱桃' })).toBeInTheDocument();
    expect(screen.getByText('分组一')).toBeInTheDocument();
    expect(screen.getByText('分组一')).toHaveAttribute('data-slot', 'select-label');
    expect(document.querySelector('[data-slot="select-separator"]')).toBeInTheDocument();
    expect(listbox.closest('[data-slot="select-content"]')).toBeInTheDocument();
  });

  it('视口可滚动时渲染上下滚动按钮（happy-dom 下手工撑出 scrollHeight）', async () => {
    render(<SelectHarness />);
    openSelect(screen.getByRole('combobox', { name: '选择尺寸' }));
    const viewport = (await screen.findByRole('listbox')).querySelector(
      '[data-radix-select-viewport]'
    ) as HTMLElement;
    expect(viewport).toBeInTheDocument();
    // 让 canScrollUp / canScrollDown 计算为 true（writable: true，避免 Radix 自动滚动写 scrollTop 报只读错）
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 200 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(viewport, 'scrollTop', { configurable: true, value: 10, writable: true });
    fireEvent.scroll(viewport);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-slot="select-scroll-up-button"]')).toBeInTheDocument();
      expect(document.querySelector('[data-slot="select-scroll-down-button"]')).toBeInTheDocument();
    });
  });

  it('键盘选择选项：onValueChange 收到值，trigger 显示新值', async () => {
    const onValueChange = vi.fn();
    render(<SelectHarness onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: '选择尺寸' });
    openSelect(trigger);
    const item = await screen.findByRole('option', { name: '樱桃' });
    // SELECTION_KEYS：Enter/Space，直接派发在 item 上
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('c');
    expect(trigger).toHaveTextContent('樱桃');
  });

  it('disabled 选项无法被选中', async () => {
    const onValueChange = vi.fn();
    render(<SelectHarness defaultValue="a" onValueChange={onValueChange} />);
    openSelect(screen.getByRole('combobox', { name: '选择尺寸' }));
    const item = await screen.findByRole('option', { name: '香蕉' });
    expect(item).toHaveAttribute('data-disabled');
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('受控 open：onOpenChange(false) 后列表关闭（Escape 关闭）', async () => {
    const onOpenChange = vi.fn();
    function Controlled() {
      const [open, setOpen] = React.useState(true);
      return (
        <Select
          open={open}
          onOpenChange={(o) => {
            onOpenChange(o);
            setOpen(o);
          }}
        >
          <SelectTrigger aria-label="选择尺寸">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="a">苹果</SelectItem>
          </SelectContent>
        </Select>
      );
    }
    render(<Controlled />);
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(await screen.findByRole('listbox'), { key: 'Escape' });
    await vi.waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('position=popper 分支：内容带 popper 定位类', async () => {
    render(<SelectHarness position="popper" />);
    openSelect(screen.getByRole('combobox', { name: '选择尺寸' }));
    const content = await screen.findByRole('listbox');
    expect(content).toBeInTheDocument();
  });

  it('点击 trigger 也能打开（非 mouse 指针类型走 click 分支）', async () => {
    render(<SelectHarness />);
    fireEvent.click(screen.getByRole('combobox', { name: '选择尺寸' }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });

  it('pointerDown 打开后点击选项选中（click 分支）', async () => {
    const onValueChange = vi.fn();
    render(<SelectHarness onValueChange={onValueChange} />);
    const trigger = screen.getByRole('combobox', { name: '选择尺寸' });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    const item = await screen.findByRole('option', { name: '苹果' });
    fireEvent.click(item);
    expect(onValueChange).toHaveBeenCalledWith('a');
  });
});
