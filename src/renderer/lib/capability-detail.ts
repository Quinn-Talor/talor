import type { ModelCapability } from '../types/models'

export interface CapabilityDetail {
  label: string
  description: string
  examples: string[]
  testHint: string
  supported: boolean
}

type CapabilityKey = `${ModelCapability['category']}/${string}`

const CAPABILITY_DETAILS: Record<string, Omit<CapabilityDetail, 'supported'>> = {
  'text/text_generation': {
    label: '文本生成',
    description: '支持自然语言文本的生成、续写、改写和问答对话。',
    examples: ['写一篇产品介绍', '总结这段文字', '翻译以下内容'],
    testHint: '在聊天框发送任意文本消息即可测试',
  },
  'vision/image_understanding': {
    label: '图片理解',
    description: '支持分析 PNG、JPEG 格式图片，理解图片内容并回答相关问题。',
    examples: ['描述这张图片的内容', '图中有哪些物体？', '读取图中的文字'],
    testHint: '在聊天框上传图片附件并提问即可测试',
  },
  'tools/function_calling': {
    label: '工具调用',
    description: '支持调用外部函数和工具，执行搜索、计算、API 请求等结构化任务。',
    examples: ['查询今天的天气', '执行代码并返回结果', '调用外部 API 获取数据'],
    testHint: '配置工具后在会话中发送需要调用工具的请求',
  },
  'video/video_analysis': {
    label: '视频分析',
    description: '支持分析视频内容，理解动作、场景和时间序列。',
    examples: ['描述这段视频的内容', '视频中发生了什么？'],
    testHint: '上传视频附件并提问即可测试（当前版本暂未支持）',
  },
  'audio/audio_transcription': {
    label: '音频转写',
    description: '支持将语音或音频内容转写为文字。',
    examples: ['转写这段录音', '翻译并转写此音频'],
    testHint: '上传音频附件即可测试（当前版本暂未支持）',
  },
}

const FALLBACK_DETAIL: Omit<CapabilityDetail, 'supported'> = {
  label: '扩展能力',
  description: '此能力的详细信息暂未记录，请参考模型官方文档。',
  examples: [],
  testHint: '请参考模型文档进行测试',
}

export function getCapabilityDetail(capability: ModelCapability): CapabilityDetail {
  const key: CapabilityKey = `${capability.category}/${capability.type}`
  const base = CAPABILITY_DETAILS[key] ?? FALLBACK_DETAIL
  return { ...base, supported: capability.supported }
}
