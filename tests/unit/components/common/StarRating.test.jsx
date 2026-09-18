// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import StarRating from '@/components/common/StarRating';

afterEach(cleanup);

describe('StarRating', () => {
  it('默认（非交互）：5 颗星，已评分星带 star 类，点击无回调不报错', () => {
    const { container } = render(<StarRating rating={3} />);
    const root = container.querySelector('.star-rating');
    expect(root).not.toBeNull();
    // 默认 max=5
    expect(root.children.length).toBe(5);
    const stars = root.querySelectorAll(':scope > span');
    expect(stars[0].className).toBe('star');
    expect(stars[2].className).toBe('star');
    expect(stars[3].className).toBe('star-empty');
    // 非交互：无 pointer 样式，点击不抛错
    expect(stars[0].style.cursor).toBe('');
    expect(() => fireEvent.click(stars[0])).not.toThrow();
    // 默认 size
    expect(container.querySelector('svg.size-3\\.5')).not.toBeNull();
  });

  it('交互模式：点击第 n 颗星回调 onChange(n)，点击已评分星回调 0', () => {
    const onChange = vi.fn();
    const { container } = render(<StarRating rating={3} interactive onChange={onChange} />);
    const stars = container.querySelectorAll('.star-rating > span');
    // 交互星有 pointer 样式
    expect(stars[0].style.cursor).toBe('pointer');
    fireEvent.click(stars[4]); // 未评分 → 5
    expect(onChange).toHaveBeenLastCalledWith(5);
    fireEvent.click(stars[2]); // 已评分（第 3 颗）→ 清零
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.click(stars[0]); // 未评分 → 1
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('交互模式但未传 onChange：点击不报错', () => {
    const { container } = render(<StarRating rating={0} interactive />);
    const star = container.querySelector('.star-rating > span');
    expect(() => fireEvent.click(star)).not.toThrow();
  });

  it('stopPropagation=true：点击不冒泡到父级', () => {
    const parentClick = vi.fn();
    const { container } = render(
      <div onClick={parentClick}>
        <StarRating rating={2} stopPropagation />
      </div>
    );
    fireEvent.click(container.querySelector('.star-rating'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('stopPropagation=false（默认）：点击冒泡到父级', () => {
    const parentClick = vi.fn();
    const { container } = render(
      <div onClick={parentClick}>
        <StarRating rating={2} />
      </div>
    );
    fireEvent.click(container.querySelector('.star-rating'));
    expect(parentClick).toHaveBeenCalledTimes(1);
  });

  it('自定义 max 与 size：只渲染 max 颗指定尺寸的星', () => {
    const { container } = render(<StarRating rating={1} max={3} size="size-6" interactive onChange={vi.fn()} />);
    const stars = container.querySelectorAll('.star-rating > span');
    expect(stars.length).toBe(3);
    expect(container.querySelector('svg.size-6')).not.toBeNull();
    expect(screen.queryByText(/星/)).toBeNull();
  });
});
