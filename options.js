// オプション画面のロジック
// ステータスメッセージを表示
function showStatus(type, message) {
  const statusDiv = document.getElementById('status');
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = 'block';
}

// 保存ボタンのクリックイベント
document.getElementById('save').addEventListener('click', async () => {
  const tokenInput = document.getElementById('token');
  const token = tokenInput.value.trim();

  // 入力チェック
  if (!token) {
    showStatus('error', 'Please enter a token.');
    return;
  }

  // トークンの形式チェック（旧:ghp_, 新:github_pat_）
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_') && token.length < 40) {
    showStatus('error', 'Invalid token format. Please enter a valid GitHub Personal Access Token.');
    return;
  }

  try {
    // Chrome storageに保存
    await chrome.storage.sync.set({ githubToken: token });
    showStatus('success', 'Token saved! Reload the page for changes to take effect.');
  } catch (error) {
    console.error('Failed to save token:', error);
    showStatus('error', 'Failed to save token: ' + error.message);
  }
});
