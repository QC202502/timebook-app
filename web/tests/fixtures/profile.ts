// Invented test-only examples. Never copy a real diary, schedule, preference or project into this fixture.
import { profile } from '../../config/profile.ts'
Object.assign(profile, {
  knownPeople: ['林林', '小安'],
  toolProjects: [
    { secondary: '工具与系统建设', project: '时间账本', label: '开发时间账本' },
    { secondary: '工具与系统建设', project: '示例工具箱', label: '优化示例工具箱' },
    { secondary: '教育工具建设', project: '示例学习工具', label: '建设示例学习工具' }
  ],
  workouts: [
    { label: '早晨组', activities: ['12 分钟拉伸课程', '深蹲 12 个', '斜撑 8 个'] },
    { label: '日间组', activities: ['4 分钟拉伸一组', '深蹲 12 个', '斜撑 8 个'] }
  ],
  pickup: { activity: '接送小安', person: '和小安', weekdays: [2, 4], start: 1080, returnStart: 1110, end: 1155 },
  lunchObject: '测试套餐＋果汁', confirmedCompanions: true,
  excludedProjects: ['其他工作事项', '示例联络', '示例支持', '项目A 推广', '项目A 商务', '沟通', '路演', '示例巡检']
})

import { CATEGORIES } from '../../shared/lib/ledger-v2.ts'
CATEGORIES.splice(CATEGORIES.findIndex(c => c.id === 'recording'), 1)
CATEGORIES.splice(CATEGORIES.findIndex(c => c.id === 'social'), 1)
CATEGORIES.find(c => c.id === 'create')!.children[0].name = '写作'
CATEGORIES.find(c => c.id === 'family')!.name = '家庭社交'
CATEGORIES.find(c => c.id === 'life')!.name = '日常事务与出行'
CATEGORIES.find(c => c.id === 'work')!.name = '工作事业'
CATEGORIES.find(c => c.id === 'create')!.children[1].name = '口播'
