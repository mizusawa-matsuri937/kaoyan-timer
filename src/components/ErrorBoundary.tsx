import { Component, type ReactNode } from 'react'

/** 某个页面出错时只显示错误卡片，不白屏；数据都在数据库里，不受影响 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card m-4 p-5">
        <div className="text-lg font-semibold">页面出了点问题</div>
        <p className="mt-1 text-sm text-muted">你的学习数据安全保存在本地，不受影响。可以尝试刷新。</p>
        <pre className="well mt-3 overflow-x-auto p-3 text-xs text-muted">{this.state.error.message}</pre>
        <button className="btn btn-primary mt-4" onClick={() => location.reload()}>
          刷新
        </button>
      </div>
    )
  }
}
