(() => {
  if (window.location.hostname !== 'github.com') {
    return;
  }

  const repoInfo = (() => {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pulls/);
    if (!match) {
      return null;
    }
    return { owner: match[1], repo: match[2] };
  })();

  if (!repoInfo) {
    return;
  }

  const reviewerCache = new Map();
  const rowPromises = new WeakMap();
  const ROW_SELECTOR = '.js-issue-row';
  const SPAN_CLASS = 'github-show-reviewer';

  // GitHub APIのヘッダーを取得（トークンがあれば含める）
  async function getApiHeaders() {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

    // Chrome storageからトークンを取得
    try {
      const result = await chrome.storage.sync.get(['githubToken']);
      if (result.githubToken) {
        headers.Authorization = `Bearer ${result.githubToken}`;
        console.log('[GitHub Show Reviewer] Using authenticated requests');
      } else {
        console.warn('[GitHub Show Reviewer] No GitHub token found - using unauthenticated requests (rate limited)');
      }
    } catch (error) {
      console.error('[GitHub Show Reviewer] Failed to get token from storage:', error);
    }

    return headers;
  }

  // PR行の中に, レビュワー情報を表示するための<span>要素を作成して返す
  function ensureInfoSpan(row) {
    // row: PR行のDOM要素
    // .opened-by: PRを作成したユーザー情報が表示される部分
    const openedBy = row.querySelector('.opened-by');
    if (!openedBy) {
      return null;
    }

    // *********** 追加前 ***********
    // <div class="opened-by">
    //   opened by araitaiga <time datetime="2025-10-18">yesterday</time>
    // </div>
    // *****************************

    // SPAN_CLASS(.github-show-reviewer)というクラス名を持つ<span>要素を探す
    let span = openedBy.querySelector(`.${SPAN_CLASS}`);
    // 以前の処理で挿入済みの場合はそのまま返す
    if (!span) {
      span = document.createElement('span');
      span.className = SPAN_CLASS;
    }
    openedBy.appendChild(span);

    // *********** 追加後 ***********
    // <div class="opened-by">
    //   opened by araitaiga <time>yesterday</time>
    //   <span class="github-show-reviewer"></span>
    // </div>
    // *****************************

    return span;
  }

  function extractPrNumber(row) {
    // row.idがissue_123のような形式であれば、123を返す
    if (row.id) {
      const byId = row.id.match(/issue_(\d+)/);
      if (byId) {
        return byId[1];
      }
    }

    // idからPR番号を抽出できなかった場合, リンクからPR番号を抽出
    const link = row.querySelector('a.Link--primary[href*="/pull/"]');
    if (link) {
      const match = link.getAttribute('href').match(/\/pull\/(\d+)/);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  function dedupe(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
      if (!seen.has(value)) {
        seen.add(value);
        result.push(value);
      }
    }
    return result;
  }

  function formatReviewerList(reviewers) {
    if (!reviewers || reviewers.length === 0) {
      return 'Reviewed by None';
    }
    return `Reviewed by ${reviewers.join(', ')}`;
  }

  // <span>要素の中身を更新するためのユーティリティ関数
  // span: 基本的なグループ化タグ. 以下のようにインラインで部分的な装飾が可能
  // <p id="msg">Hello, <span id="name">World</span>!</p>
  // text: 表示したい文字列
  function setSpanText(span, text, isError = false) {
    // textの先頭に区切り文字を付与する
    span.textContent = ` • ${text}`;
    // isErrorがtrueの場合, エラースタイルを適用(style.cssで定義)
    // 通常状態：.github-show-reviewer(white-space: normal)
    // エラー状態：.github-show-reviewer--error(color: var(--fgColor-danger, #cf222e))
    span.classList.toggle(`${SPAN_CLASS}--error`, isError);
  }

  async function fetchReviewers(prNumber) {
    // PR番号のリクエストごとにキャッシュを作成
    const cacheKey = `${repoInfo.owner}/${repoInfo.repo}#${prNumber}`;
    if (reviewerCache.has(cacheKey)) {
      return reviewerCache.get(cacheKey);
    }


    const request = (async () => {
      const pullUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`;
      const reviewsUrl = `${pullUrl}/reviews`;
      try {
        console.log(`[GitHub Show Reviewer] Fetching PR #${prNumber}`);

        // 認証ヘッダーを取得
        const headers = await getApiHeaders();

        // // API_HEADERS: GitHub API用の標準ヘッダー
        // fetch(pullUrl, { headers: API_HEADERS }),
        // fetch(reviewsUrl, { headers: API_HEADERS }),

        // Promise.all: 複数の非同期処理を並行して実行し、それらがすべて完了したら結果を配列で返す
        const [pullResponse, reviewsResponse] = await Promise.all([
            fetch(pullUrl, { headers }),
            fetch(reviewsUrl, { headers }),
          ]);

        if (!pullResponse.ok) {
          const errorText = await pullResponse.text();
          console.error(`[GitHub Show Reviewer] API Error:`, errorText);
          throw new Error(`GitHub API error ${pullResponse.status}: ${errorText.substring(0, 100)}`);
        }

        const pullData = await pullResponse.json();
        // レビュー中のユーザーを抽出
        // requested_reviewers: リクエストされたレビュワーの一覧
        const users = Array.isArray(pullData.requested_reviewers)
          ? pullData.requested_reviewers.map((user) => user.login)
          : [];
        // requested_teams: リクエストされたチームの一覧
        const teams = Array.isArray(pullData.requested_teams)
          ? pullData.requested_teams.map((team) => `@${team.slug}`)
          : [];

        let reviews = [];
        if (reviewsResponse.ok) {
          reviews = await reviewsResponse.json();
        }

        // レビュー済みのユーザーを抽出
        const reviewUsers = Array.isArray(reviews)
          ? reviews
            .filter(
              (review) =>
                review &&
                review.user &&
                review.user.login &&
                review.state &&
                review.state.toUpperCase() !== 'PENDING'
            )
            .map((review) => review.user.login)
          : [];

        // 重複を排除
        const reviewers = dedupe([...users, ...teams, ...reviewUsers]);
        console.log(`[GitHub Show Reviewer] Found reviewers:`, reviewers);
        return { reviewers };
      } catch (error) {
        console.error(`[GitHub Show Reviewer] Fetch error:`, error);
        return { error: error.message || 'Unknown error' };
      }
    })();

    reviewerCache.set(cacheKey, request);
    return request;
  }

  function updateRow(row) {
    // PR番号を抽出
    const prNumber = extractPrNumber(row);
    if (!prNumber) {
      console.warn(`[GitHub Show Reviewer] Could not extract PR number from row`);
      return;
    }
    console.log(`[GitHub Show Reviewer] Processing PR #${prNumber}`);

    // PR行の中に, レビュワー情報を表示するための<span>要素を作成して返す
    const infoSpan = ensureInfoSpan(row);
    if (!infoSpan) {
      console.warn(`[GitHub Show Reviewer] Could not create info span for PR #${prNumber}`);
      return;
    }

    // 既に処理中の場合はスキップ（重複リクエスト防止）
    if (rowPromises.has(row)) {
      console.log(`[GitHub Show Reviewer] PR #${prNumber} is already being processed`);
      return;
    }

    // レビュワー情報取得中の表示をセット
    setSpanText(infoSpan, 'Reviewed by Loading...');
    // title属性: マウスを載せたときにブラウザが自動的に表示するツールチップの内容
    // 基本削除し, エラー発生時のみinfoSpan.titleを設定する
    infoSpan.removeAttribute('title');

    const promise = fetchReviewers(prNumber);
    rowPromises.set(row, promise);

    promise.then(({ reviewers, error }) => {
      if (rowPromises.get(row) !== promise) {
        console.log(`[GitHub Show Reviewer] Promise mismatch for PR #${prNumber}, ignoring result`);
        return;
      }

      if (error) {
        console.error(`[GitHub Show Reviewer] Error for PR #${prNumber}:`, error);
        setSpanText(infoSpan, 'Reviewed by N/A', true);
        infoSpan.title = error;
        return;
      }

      console.log(`[GitHub Show Reviewer] Updating display for PR #${prNumber} with reviewers:`, reviewers);
      setSpanText(infoSpan, formatReviewerList(reviewers));
      infoSpan.removeAttribute('title');
    });

    row.dataset.githubShowReviewerProcessed = 'true';
  }

  function processRows(root = document) {
    // DOMツリー内の検索対象範囲(root), 検索結果(rows)
    // querySelectorAll: CSSセレクタでROW_SELECTORに一致する要素を検索するメソッド
    const rows = root.querySelectorAll(ROW_SELECTOR);
    rows.forEach((row) => {
      // 既にgithubShowReviewerが処理済みの行はスキップ
      if (row.dataset.githubShowReviewerProcessed === 'true') {
        return;
      }
      updateRow(row);
    });
  }

  const observer = new MutationObserver((mutations) => {
    // MutationObserver: DOMの変更を監視するオブジェクト. 以下に変化したときの処理を記述する
    // mutations: 検知された全てのDOMの変更内容の配列
    for (const mutation of mutations) {
      // mutation.addedNodes: 新しく追加されたノードの配列
      mutation.addedNodes.forEach((node) => {
        // nodeがHTML要素(<div>など)のインスタンスでない場合はスキップ
        if (!(node instanceof HTMLElement)) {
          return;
        }
        // ROW_SELECTOR: 定義済みのCSSセレクタ (.js-issue-row)
        // = GitHubのPRリストの1行を表す要素
        if (node.matches?.(ROW_SELECTOR)) {
          // 処理済みフラグをリセットしてrowを更新
          node.dataset.githubShowReviewerProcessed = '';
          updateRow(node);
        }
        // nestedRows: 子要素の中にもROW_SELECTORに一致する要素がある場合は、それも更新
        const nestedRows = node.querySelectorAll?.(ROW_SELECTOR);
        if (nestedRows && nestedRows.length > 0) {
          nestedRows.forEach((row) => {
            row.dataset.githubShowReviewerProcessed = '';
            updateRow(row);
          });
        }
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  processRows();
})();
