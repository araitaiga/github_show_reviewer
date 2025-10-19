// オプション画面のロジック

// ページ読み込み時に保存されているトークンを表示
document.addEventListener('DOMContentLoaded', async () => {
  const tokenInput = document.getElementById('token');
  const statusDiv = document.getElementById('status');

  try {
    const result = await chrome.storage.sync.get(['githubToken']);
    if (result.githubToken) {
      // セキュリティのため、最初の4文字と最後の4文字のみ表示
      const token = result.githubToken;
      if (token.length > 8) {
        tokenInput.value = token.substring(0, 4) + '...' + token.substring(token.length - 4);
        tokenInput.dataset.hasExisting = 'true';
      } else {
        tokenInput.value = token;
      }
    }
  } catch (error) {
    console.error('Failed to load token:', error);
  }

  // 入力フィールドにフォーカスが当たったらクリア（既存トークンがある場合）
  tokenInput.addEventListener('focus', () => {
    if (tokenInput.dataset.hasExisting === 'true') {
      tokenInput.value = '';
      delete tokenInput.dataset.hasExisting;
    }
  });
});

// 保存ボタンのクリックイベント
document.getElementById('save').addEventListener('click', async () => {
  const tokenInput = document.getElementById('token');
  const statusDiv = document.getElementById('status');
  const token = tokenInput.value.trim();

  // 入力チェック
  if (!token) {
    showStatus('error', 'Please enter a token.');
    return;
  }

  // トークンの形式チェック（ghp_で始まる、または古い形式）
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_') && token.length < 40) {
    showStatus('error', 'Invalid token format. Please enter a valid GitHub Personal Access Token.');
    return;
  }

  try {
    // Chrome storageに保存
    await chrome.storage.sync.set({ githubToken: token });
    showStatus('success', 'Token saved! Reload the page for changes to take effect.');

    // 保存後、表示用にマスク
    setTimeout(() => {
      if (token.length > 8) {
        tokenInput.value = token.substring(0, 4) + '...' + token.substring(token.length - 4);
        tokenInput.dataset.hasExisting = 'true';
      }
    }, 100);
  } catch (error) {
    console.error('Failed to save token:', error);
    showStatus('error', 'Failed to save token: ' + error.message);
  }
});

// ステータスメッセージを表示
function showStatus(type, message) {
  const statusDiv = document.getElementById('status');
  statusDiv.className = `status ${type}`;
  statusDiv.textContent = message;
  statusDiv.style.display = 'block';

  // 成功メッセージは3秒後に自動的に消す
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}
