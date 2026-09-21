import { Component } from 'react';

// 顶层错误边界：渲染异常时给出可操作的降级界面，避免整窗白屏
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] 渲染异常:', error?.message, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ error: null });
    window.location.hash = '#/';
  };

  render() {
    const { error } = this.state;
    const { children } = this.props;
    if (!error) return children;
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 12,
          padding: 24,
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontSize: 18 }}>界面出现问题</h2>
        <p style={{ maxWidth: 480, opacity: 0.7 }}>{String(error?.message || error)}</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={this.handleGoHome}
            style={{ padding: '8px 20px', cursor: 'pointer' }}
          >
            回到图库
          </button>
          <button
            type="button"
            onClick={this.handleReload}
            style={{ padding: '8px 20px', cursor: 'pointer' }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
