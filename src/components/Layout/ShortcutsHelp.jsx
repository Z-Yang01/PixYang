import { Button } from '@/components/ui/button';
import { X, Keyboard, BookOpen } from 'lucide-react';
import { SHORTCUT_GROUPS } from '@/lib/shortcuts.ts';

// 统一帮助弹窗：快捷键（? 键）+ 使用说明两章——原双弹窗（HelpGuide）合并，侧栏只留 ? 键入口
const GUIDE_SECTIONS = [
  {
    title: '图库浏览',
    lines: [
      '按导入日期分组浏览，侧边栏可按日期、标签、相册、收藏筛选',
      '顶栏搜索支持图片名、标签名、备注（按 / 快速聚焦）；可切换日期/名称/大小/评分排序',
      '鼠标悬停卡片可勾选（或 Ctrl+A 全选），勾选后顶部出现批量工具：评分、收藏、加标签、删除、导出',
      '点击图片进入查看器：← → 翻页，滚轮/按钮缩放，按 I 或右上角按钮查看详细信息',
    ],
  },
  {
    title: '导入图片',
    lines: [
      '左下「导入图片」或顶栏「导入」：选择文件夹 → 勾选要导入的照片 → 确认',
      '直接把文件/文件夹拖进窗口也可以导入',
      '同名 JPG+RAW（NEF/CR2/ARW/DNG）自动配对：JPG 为可见照片，RAW 作为底片保留',
      '导入时可选择「使用拍摄日期」归档（无拍摄时间的照片按文件修改时间）',
    ],
  },
  {
    title: '编辑图片',
    lines: [
      '查看器中点「编辑」进入：右侧面板调整曝光、白平衡、影调、曲线、HSL、颜色分级、饱和度、暗角与细节',
      '蒙版支持径向/线性/亮度范围，可叠加多个做局部调整；裁剪与旋转/翻转在「裁剪」页签',
      '所有调整均为非破坏式：保存参数不会改动原图像素',
      '「烘焙」才会把效果写回原图（覆盖前有确认）；「导出」则生成一份副本，原图不动',
      '调整后点 X 会询问是否放弃未保存的参数',
    ],
  },
  {
    title: '管理与备份',
    lines: [
      '手动删除的图片进「回收站」，24 小时内可随时恢复到原位置',
      '标签、相册在左侧导航管理；评分在查看器或卡片悬停星标设置',
      '设置页可一键备份数据库；所有数据都在本机',
    ],
  },
];

export default function ShortcutsHelp({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Keyboard className="size-4" />
          快捷键
          <Button
            variant="ghost"
            size="icon-xs"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
            title="关闭"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="dialog-body" style={{ maxHeight: '65vh' }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.4px',
                  marginBottom: 8,
                }}
              >
                {group.title}
              </div>
              <div className="info-group" style={{ padding: '6px 12px' }}>
                {group.items.map((item) => (
                  <div key={item.desc} className="info-row" style={{ gap: 12 }}>
                    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {item.keys.map((k) => (
                        <kbd key={k} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                    <span
                      className="info-value"
                      style={{ color: 'var(--text-secondary)', fontSize: 12 }}
                    >
                      {item.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ marginBottom: 4 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.4px',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <BookOpen className="size-3.5" /> 使用说明
            </div>
            <div className="info-group" style={{ padding: '6px 12px' }}>
              {GUIDE_SECTIONS.map((section) => (
                <div key={section.title} style={{ padding: '6px 0' }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      marginBottom: 2,
                    }}
                  >
                    {section.title}
                  </div>
                  {section.lines.map((line) => (
                    <div
                      key={line}
                      className="info-value"
                      style={{ color: 'var(--text-secondary)', fontSize: 12, padding: '1px 0' }}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
