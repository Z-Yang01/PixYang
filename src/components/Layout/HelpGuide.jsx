import { Button } from '@/components/ui/button';
import { X, BookOpen } from 'lucide-react';

const SECTIONS = [
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
      '同名 JPG+NEF 会自动配对：JPG 为可见照片，NEF 作为底片保留',
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
    title: '标签与相册',
    lines: [
      '「管理标签」可新建、删除标签并调整颜色',
      '勾选图片后可批量加/移除标签；相册支持新建、改名、删除与排序',
    ],
  },
  {
    title: '数据与维护',
    lines: [
      '数据库、缩略图与编辑缓存保存在安装目录 data\\ 文件夹下',
      '照片本体保存在你自己的图片文件夹中（设置里可查看/修改，修改时会自动搬移文件）',
      '设置页提供：重建缩略图（缺图/花图时使用）、损坏记录清理、重复照片查找、数据库备份',
    ],
  },
  {
    title: '快捷键',
    lines: ['点侧边栏「快捷键」查看全部按键（也可随时按 ? 呼出）'],
  },
];

export default function HelpGuide({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BookOpen className="size-4" />
          使用说明
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
          {SECTIONS.map((section) => (
            <div key={section.title} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 6,
                }}
              >
                {section.title}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: 13 }}>
                {section.lines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
