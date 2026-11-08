/**
 * Xian优化器 — localization benchmark cases.
 *
 * Ground truth is intentionally small and hand-labelled. `primary` is the file
 * a developer must open first; `related` are valid supporting files (tests,
 * styles, data) that a good brief should also mention.
 */

export const fixtureCases = [
  {
    id: 'fixture-remember',
    prompt: '给登录页面加一个记住我复选框，并调整登录按钮样式',
    primary: ['src/pages/LoginPage.tsx'],
    related: ['src/components/LoginButton.tsx', 'src/styles/login.css', 'src/pages/__tests__/LoginPage.test.tsx'],
  },
  {
    id: 'fixture-validation',
    prompt: '登录表单增加邮箱格式校验并提示错误',
    primary: ['src/utils/validate.ts'],
    related: ['src/pages/LoginPage.tsx', 'src/pages/__tests__/LoginPage.test.tsx'],
  },
  {
    id: 'fixture-api-error',
    prompt: '登录接口失败时显示更友好的错误信息',
    primary: ['src/api/auth.ts'],
    related: ['src/pages/LoginPage.tsx'],
  },
  {
    id: 'fixture-loading',
    prompt: '给登录按钮增加 loading 状态并禁用重复点击',
    primary: ['src/components/LoginButton.tsx'],
    related: ['src/pages/LoginPage.tsx', 'src/styles/login.css'],
  },
  {
    id: 'fixture-test',
    prompt: '给登录页补充交互测试',
    primary: ['src/pages/__tests__/LoginPage.test.tsx'],
    related: ['src/pages/LoginPage.tsx'],
  },
  {
    id: 'fixture-style',
    prompt: '把登录按钮改成圆角并调整 hover 颜色',
    primary: ['src/styles/login.css'],
    related: ['src/components/LoginButton.tsx'],
  },
  {
    id: 'fixture-config',
    prompt: '给项目补充 lint 脚本和 ESLint 配置',
    primary: ['package.json'],
    related: [],
  },
  {
    id: 'fixture-docs',
    prompt: '更新 README，补充测试命令',
    primary: ['README.md'],
    related: [],
  },
];

export const realCases = [
  {
    id: 'real-emotion',
    prompt: '在情绪模型里增加一种新情绪标签',
    primary: ['core/emotion_model.py'],
    related: ['qq_bot_relay.py', 'training/build_dataset.py'],
  },
  {
    id: 'real-checkin',
    prompt: '调整签到功能的连续签到奖励规则',
    primary: ['qq_bot_relay.py'],
    related: ['checkin.json'],
  },
  {
    id: 'real-dataset',
    prompt: '训练数据打标时保留更多实体信息',
    primary: ['training/build_dataset.py'],
    related: ['core/emotion_model.py'],
  },
  {
    id: 'real-auto-learn',
    prompt: '自动学习脚本跳过已处理过的视频',
    primary: ['auto_learn.py'],
    related: ['assets/auto_learn_state.json'],
  },
  {
    id: 'real-repeat',
    prompt: '修复机器人重复回复消息的问题',
    primary: ['qq_bot_relay.py'],
    related: [],
  },
  {
    id: 'real-persona',
    prompt: '更新人设中的情绪表达风格',
    primary: ['assets/persona.base.json'],
    related: ['qq_bot_relay.py', 'core/emotion_model.py'],
  },
];

/**
 * Held-out cases. Do not use these to tune ranking rules: they exist to check
 * whether the tuned rules generalise beyond the cases that motivated them.
 */
export const heldoutCases = [
  {
    id: 'heldout-fixture-forgot',
    prompt: '给登录页添加忘记密码链接',
    primary: ['src/pages/LoginPage.tsx'],
    related: ['src/styles/login.css', 'src/pages/__tests__/LoginPage.test.tsx'],
  },
  {
    id: 'heldout-fixture-enter',
    prompt: '让登录表单支持按回车提交',
    primary: ['src/pages/LoginPage.tsx'],
    related: ['src/components/LoginButton.tsx'],
  },
  {
    id: 'heldout-fixture-rule',
    prompt: '把邮箱校验抽成可复用规则',
    primary: ['src/utils/validate.ts'],
    related: ['src/pages/LoginPage.tsx'],
  },
  {
    id: 'heldout-fixture-timeout',
    prompt: '登录请求增加超时处理',
    primary: ['src/api/auth.ts'],
    related: ['src/pages/LoginPage.tsx'],
  },
  {
    id: 'heldout-real-voice',
    prompt: '语音配置里增加新的音色风格',
    primary: ['assets/voice_config.json'],
    related: ['qq_bot_relay.py'],
  },
  {
    id: 'heldout-real-export',
    prompt: '调整问答数据导出的表格格式',
    primary: ['training/create_qa_xlsx.py'],
    related: ['training/build_dataset.py'],
  },
  {
    id: 'heldout-real-help',
    prompt: '给群聊命令增加新的帮助文案',
    primary: ['qq_bot_relay.py'],
    related: [],
  },
  {
    id: 'heldout-real-log',
    prompt: '优化自动学习脚本的日志输出',
    primary: ['auto_learn.py'],
    related: [],
  },
];

/**
 * @param {{id:string,prompt:string,primary:string[],related:string[]}} item
 * @param {(message:string)=>void} [log]
 */
export function explainCase(item, log = () => {}) {
  log(`${item.id}: ${item.prompt}`);
}
