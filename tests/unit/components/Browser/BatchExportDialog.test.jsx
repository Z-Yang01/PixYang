// @vitest-environment happy-dom
// BatchExportDialog（功能 13a）：模式切换显隐、转换字段、预设存取（settings 通道 mock）、
// 确认负载（copy → null / convert → 归一对象）、取消回调。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import BatchExportDialog from '@/components/Browser/BatchExportDialog';
import useGalleryStore from '@/store/galleryStore';

const initialSnapshot = useGalleryStore.getState();

describe('BatchExportDialog（13a）', () => {
  beforeEach(() => {
    useGalleryStore.setState(initialSnapshot, true);
    useGalleryStore.setState({ selectedIds: new Set([1, 2, 3]) });
    window.pixyang = {};
  });

  afterEach(() => {
    cleanup();
    delete window.pixyang;
  });

  const open = (props = {}) =>
    render(
      <BatchExportDialog
        onConfirm={props.onConfirm ?? vi.fn()}
        onCancel={props.onCancel ?? vi.fn()}
      />
    );

  const modeSelect = () => screen.getByLabelText('导出方式');

  it('默认原样复制：转换字段不渲染，确认负载为 null', () => {
    const onConfirm = vi.fn();
    open({ onConfirm });
    expect(screen.getByText(/已选 3 张/)).toBeInTheDocument();
    expect(screen.getByText(/按原文件原样复制/)).toBeInTheDocument();
    expect(screen.queryByLabelText('导出格式')).toBeNull();
    fireEvent.click(screen.getByText('选择目录并导出'));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it('切到转格式与尺寸：字段出现，确认负载经 buildConvertOptions 归一', () => {
    const onConfirm = vi.fn();
    open({ onConfirm });
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    expect(screen.getByLabelText('导出格式')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('导出格式'), { target: { value: 'webp' } });
    fireEvent.change(screen.getByLabelText('导出质量'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('导出最长边'), { target: { value: '1920' } });
    fireEvent.click(screen.getByText('选择目录并导出'));
    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'convert',
      format: 'webp',
      quality: 80,
      maxEdge: 1920,
    });
  });

  it('PNG 无损：质量滑杆隐藏为提示；非法长边输入归一为原尺寸', () => {
    const onConfirm = vi.fn();
    open({ onConfirm });
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    expect(screen.getByLabelText('导出质量')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('导出格式'), { target: { value: 'png' } });
    expect(screen.queryByLabelText('导出质量')).toBeNull();
    expect(screen.getByText(/PNG 为无损格式/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('导出最长边'), { target: { value: '-7' } });
    fireEvent.click(screen.getByText('选择目录并导出'));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ format: 'png', maxEdge: 0 }));
  });

  it('预设：挂载读 settings，选中预设灌入表单并切到转换模式', async () => {
    window.pixyang.getSetting = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify([{ name: '网页图', format: 'webp', quality: 75, maxEdge: 1280 }])
      );
    window.pixyang.setSetting = vi.fn().mockResolvedValue(null);
    open();
    await waitFor(() => expect(window.pixyang.getSetting).toHaveBeenCalledWith('exportPresets'));
    // 预设区在转换模式分支内：先切模式再操作
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    const presetSelect = await screen.findByLabelText('导出预设');
    fireEvent.change(presetSelect, { target: { value: '0' } });
    expect(modeSelect().value).toBe('convert');
    expect(screen.getByLabelText('导出格式').value).toBe('webp');
    expect(screen.getByLabelText('导出质量').value).toBe('75');
    expect(screen.getByLabelText('导出最长边').value).toBe('1280');
  });

  it('预设：存为预设写入 settings（坏项剔除），删除同步落盘', async () => {
    window.pixyang.getSetting = vi
      .fn()
      .mockResolvedValue(JSON.stringify([{ name: '旧', format: 'png', quality: 88, maxEdge: 0 }]));
    window.pixyang.setSetting = vi.fn().mockResolvedValue(null);
    open();
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    // 等 settings 里的既有预设装载完成（否则保存时会以空列表起手丢掉「旧」）
    const presetSelect = await screen.findByLabelText('导出预设');
    await waitFor(() => expect(presetSelect.options.length).toBe(2));
    fireEvent.change(screen.getByLabelText('导出格式'), { target: { value: 'jpeg' } });
    fireEvent.change(screen.getByLabelText('预设名称'), { target: { value: ' 高清 ' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(window.pixyang.setSetting).toHaveBeenCalledTimes(1));
    const [key, value] = window.pixyang.setSetting.mock.calls[0];
    expect(key).toBe('exportPresets');
    expect(JSON.parse(value)).toEqual([
      { name: '旧', format: 'png', quality: 88, maxEdge: 0 },
      { name: '高清', format: 'jpeg', quality: 92, maxEdge: 0 },
    ]);
    // 删除选中预设：先选中再删，落盘只剩「高清」
    fireEvent.change(screen.getByLabelText('导出预设'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => expect(window.pixyang.setSetting).toHaveBeenCalledTimes(2));
    expect(JSON.parse(window.pixyang.setSetting.mock.calls[1][1])).toEqual([
      { name: '高清', format: 'jpeg', quality: 92, maxEdge: 0 },
    ]);
  });

  it('坏预设数据不堵死对话框：非法 JSON 归空列表，下拉只剩占位项', async () => {
    window.pixyang.getSetting = vi.fn().mockResolvedValue('{broken');
    window.pixyang.setSetting = vi.fn().mockResolvedValue(null);
    open();
    await waitFor(() => expect(window.pixyang.getSetting).toHaveBeenCalledWith('exportPresets'));
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    const presetSelect = screen.getByLabelText('导出预设');
    expect(presetSelect.options.length).toBe(1);
    expect(presetSelect.options[0].value).toBe('');
  });

  it('取消回调；无注入面时不发起 settings 读取也不抛错', () => {
    const onCancel = vi.fn();
    delete window.pixyang;
    open({ onCancel });
    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("回归 R89：选中预设后切回占位项只清选中不改表单（Number('')===0 不得误套第一条）", async () => {
    window.pixyang.getSetting = vi.fn().mockResolvedValue(
      JSON.stringify([
        { name: '网页图', format: 'webp', quality: 75, maxEdge: 1280 },
        { name: '收藏', format: 'jpeg', quality: 90, maxEdge: 2560 },
      ])
    );
    window.pixyang.setSetting = vi.fn().mockResolvedValue(null);
    open();
    await waitFor(() => expect(window.pixyang.getSetting).toHaveBeenCalledWith('exportPresets'));
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    const presetSelect = screen.getByLabelText('导出预设');
    // 选中第二条预设：表单灌入 jpeg/90/2560
    fireEvent.change(presetSelect, { target: { value: '1' } });
    expect(screen.getByLabelText('导出格式').value).toBe('jpeg');
    expect(screen.getByLabelText('导出质量').value).toBe('90');
    expect(screen.getByLabelText('导出最长边').value).toBe('2560');
    // 切回占位项「选择预设…」（value=''）：只清选中高亮，表单保持不动
    fireEvent.change(presetSelect, { target: { value: '' } });
    expect(presetSelect.value).toBe('');
    expect(screen.getByLabelText('导出格式').value).toBe('jpeg');
    expect(screen.getByLabelText('导出质量').value).toBe('90');
    expect(screen.getByLabelText('导出最长边').value).toBe('2560');
  });

  it('回归 R89：预设落盘失败必须 toast 报错（显式保存不静默，对齐设置页 R-8）', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => {});
    window.pixyang.getSetting = vi.fn().mockResolvedValue('[]');
    window.pixyang.setSetting = vi.fn().mockRejectedValue(new Error('database is locked'));
    open();
    fireEvent.change(modeSelect(), { target: { value: 'convert' } });
    const presetSelect = await screen.findByLabelText('导出预设');
    await waitFor(() => expect(presetSelect.options.length).toBe(1));
    fireEvent.change(screen.getByLabelText('预设名称'), { target: { value: '高清' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(window.pixyang.setSetting).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('预设保存失败：数据库正被其他程序占用')
    );
    toastSpy.mockRestore();
    errSpy.mockRestore();
  });
});
