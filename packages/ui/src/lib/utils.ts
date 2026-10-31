import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * shadcn/ui 官方通用样式合并工具函数
 * 用于安全合并 Tailwind CSS 类名并正确处理优先级覆盖
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
