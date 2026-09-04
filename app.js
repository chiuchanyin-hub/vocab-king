// --- 系統設定與密碼 ---
const ADMIN_PASSWORD = "admin888";
let isAdminAuthenticated = false;

let defaultQuestions = [];
let customQuestions = JSON.parse(localStorage.getItem('custom_questions') || '[]');
let allQuestions = [];

let activeGameList = [];
let currentGameIndex = 0;
let gameScore = 0;
let gameCorrectCount = 0;
let gameTotalCount = 0;
let gameTimer = null;
let gameTimeLeft = 15;
const GAME_INITIAL_TIME = 15;
let autoPronounceTimeout = null;
let isCurrentQuestionSubmitted = false; // 是否已確認送出當前題目

// 克漏字對戰變數 (支援 PVE 人機 / PVP 雙人)
let activeClozeList = [];
let currentClozeIndex = 0;
let clozeBattleMode = 'pve';
let p1Score = 0;
let p2Score = 0;
let pvpTurn = 1;
let clozeTimer = null;
let clozeTimeLeft = 10;
const CLOZE_INITIAL_TIME = 10;
const CIRCLE_CIRCUMFERENCE = 264;

let mistakeIds = new Set(JSON.parse(localStorage.getItem('mistakes') || '[]'));

// 語音發音
function playSound(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'en-US';
    utter.rate = 0.85;
    window.speechSynthesis.speak(utter);
  }
}

// 刷新題庫
function refreshTotalQuestions() {
  defaultQuestions = defaultQuestions.map(q => ({ ...q, chapter: q.chapter || "Unit 1" }));
  allQuestions = [...defaultQuestions, ...customQuestions];
  document.getElementById('total-word-count').innerText = allQuestions.length;
  updateChapterDropdowns();
}

function updateChapterDropdowns() {
  const chapters = ["全部章節", ...new Set(allQuestions.map(q => q.chapter || "Unit 1"))];
  const gameSelect = document.getElementById('game-chapter-filter');
  const clozeSelect = document.getElementById('cloze-chapter-filter');

  const curG = gameSelect.value || "全部章節";
  const curC = clozeSelect.value || "全部章節";

  const opts = chapters.map(c => `<option value="${c}">${c}</option>`).join('');
  gameSelect.innerHTML = opts;
  clozeSelect.innerHTML = opts;

  gameSelect.value = chapters.includes(curG) ? curG : "全部章節";
  clozeSelect.value = chapters.includes(curC) ? curC : "全部章節";

  refreshAdminChapterSelector();
  filterGameList();
  filterClozeList();
}

function refreshAdminChapterSelector() {
  const select = document.getElementById('import-chapter-select');
  if (!select) return;
  const uniqueChapters = [...new Set(allQuestions.map(q => q.chapter || "Unit 1"))];
  select.innerHTML = uniqueChapters.map(c => `<option value="${c}">現有章節：${c}</option>`).join('');
}

async function initApp() {
  try {
    const res = await fetch('questions.json');
    defaultQuestions = await res.json();
  } catch (err) {
    console.warn("使用預設題庫或本機執行中", err);
    defaultQuestions = [];
  }

  refreshTotalQuestions();
  setupTabs();
  setupAdminAuth();
  updateMistakeBadge();
  startNewGameSession();
  loadClozeBattleRound();
}

// 頁籤導覽
function setupTabs() {
  const tabs = [
    { btn: 'tab-game-btn', view: 'view-game' },
    { btn: 'tab-cloze-btn', view: 'view-cloze' },
    { btn: 'tab-mistakes-btn', view: 'view-mistakes' },
    { btn: 'tab-admin-btn', view: 'view-admin' }
  ];

  tabs.forEach(t => {
    document.getElementById(t.btn).addEventListener('click', () => {
      tabs.forEach(o => {
        document.getElementById(o.btn).classList.remove('active');
        document.getElementById(o.view).classList.remove('active');
      });
      document.getElementById(t.btn).classList.add('active');
      document.getElementById(t.view).classList.add('active');

      clearInterval(gameTimer);
      clearInterval(clozeTimer);
      if (autoPronounceTimeout) clearTimeout(autoPronounceTimeout);

      if (t.view === 'view-game') {
        if (!isCurrentQuestionSubmitted) startGameTimer();
      } else if (t.view === 'view-cloze') {
        startClozeTimer();
      } else if (t.view === 'view-mistakes') {
        renderMistakes();
      } else if (t.view === 'view-admin') {
        checkAdminDisplay();
      }
    });
  });

  document.getElementById('game-chapter-filter').addEventListener('change', () => {
    filterGameList();
    startNewGameSession();
  });

  document.getElementById('cloze-chapter-filter').addEventListener('change', () => {
    filterClozeList();
    currentClozeIndex = 0;
    loadClozeBattleRound();
  });

  document.getElementById('mode-pve-btn').addEventListener('click', () => {
    clozeBattleMode = 'pve';
    document.getElementById('mode-pve-btn').classList.add('active');
    document.getElementById('mode-pvp-btn').classList.remove('active');
    document.getElementById('p2-avatar').innerText = '🤖';
    document.getElementById('p2-name').innerText = '教練 AI';
    document.getElementById('turn-indicator-bar').innerText = '對抗模式：挑戰 AI 教練';
    resetClozeScores();
  });

  document.getElementById('mode-pvp-btn').addEventListener('click', () => {
    clozeBattleMode = 'pvp';
    document.getElementById('mode-pvp-btn').classList.add('active');
    document.getElementById('mode-pve-btn').classList.remove('active');
    document.getElementById('p2-avatar').innerText = '👤';
    document.getElementById('p2-name').innerText = '玩家 2';
    pvpTurn = 1;
    document.getElementById('turn-indicator-bar').innerText = '當前回合：玩家 1 作答';
    resetClozeScores();
  });
}

function filterGameList() {
  const f = document.getElementById('game-chapter-filter').value;
  activeGameList = f === "全部章節" ? allQuestions : allQuestions.filter(q => q.chapter === f);
}

function filterClozeList() {
  const f = document.getElementById('cloze-chapter-filter').value;
  activeClozeList = f === "全部章節" ? allQuestions : allQuestions.filter(q => q.chapter === f);
}

// =================== 模式 1：單字挑戰王 (虛線 + 拼錯標紅 + NEXT按鈕) ===================
function focusHiddenInput() {
  if (isCurrentQuestionSubmitted) return;
  const input = document.getElementById('answer-input');
  if (input) input.focus();
}

// 動態渲染虛線格 (包含答題後的逐字標紅對比邏輯)
function renderLetterSlots(targetWord, currentVal = '', isEvaluated = false) {
  const container = document.getElementById('letter-slots-container');
  if (!container) return;
  container.innerHTML = '';

  const targetChars = targetWord.toLowerCase().split('');
  const userLetters = currentVal.toLowerCase().split('');

  let charIdx = 0;
  targetChars.forEach((c) => {
    if (c === ' ') {
      const spaceDiv = document.createElement('div');
      spaceDiv.className = 'slot-space';
      container.appendChild(spaceDiv);
    } else {
      const slot = document.createElement('div');
      slot.className = 'slot-dash';
      
      const userChar = userLetters[charIdx] || '';
      slot.innerText = userChar;

      if (isEvaluated) {
        // 已送出驗證：拼錯標紅色，拼對標綠色
        if (userChar === c) {
          slot.classList.add('correct-char');
        } else {
          slot.classList.add('wrong-char');
          // 如果孩子少打字，直接把漏掉的格子上紅底
          if (!userChar) slot.innerText = '•';
        }
      } else {
        // 打字中狀態
        if (userChar) {
          slot.classList.add('filled');
        } else if (charIdx === userLetters.length) {
          slot.classList.add('active');
        }
      }

      container.appendChild(slot);
      charIdx++;
    }
  });
}

function startNewGameSession() {
  currentGameIndex = 0;
  gameScore = 0;
  gameCorrectCount = 0;
  gameTotalCount = activeGameList.length;
  document.getElementById('score-display').innerText = `積分：0`;
  document.getElementById('round-summary-modal').style.display = 'none';
  loadGameQuestion();
}

function loadGameQuestion() {
  if (!activeGameList.length) {
    document.getElementById('quiz-chinese').innerText = "此章節無單字";
    return;
  }

  if (currentGameIndex >= activeGameList.length) {
    triggerRoundSummary();
    return;
  }

  isCurrentQuestionSubmitted = false;
  const q = activeGameList[currentGameIndex];
  
  document.getElementById('game-progress-tag').innerText = `進度：${currentGameIndex + 1} / ${gameTotalCount}`;
  document.getElementById('quiz-chapter').innerText = q.chapter || "Unit 1";
  document.getElementById('quiz-pos').innerText = q.pos;
  document.getElementById('quiz-chinese').innerText = q.zh;
  document.getElementById('quiz-hint').innerText = `長度：${q.word.length} 字元・首字母 [ ${q.word[0]} ]`;

  const input = document.getElementById('answer-input');
  input.value = '';
  input.disabled = false;
  input.maxLength = q.word.length;
  focusHiddenInput();

  // 繪製初始虛線
  renderLetterSlots(q.word, '');

  document.getElementById('game-feedback').style.display = 'none';
  document.getElementById('submit-btn').style.display = 'block';
  document.getElementById('next-question-btn').style.display = 'none';

  if (autoPronounceTimeout) clearTimeout(autoPronounceTimeout);

  // 第 2 秒自動真人發音
  autoPronounceTimeout = setTimeout(() => {
    playSound(q.word);
  }, 1000);

  gameTimeLeft = GAME_INITIAL_TIME;
  startGameTimer();
}

function startGameTimer() {
  clearInterval(gameTimer);
  updateGameTimerUI();

  gameTimer = setInterval(() => {
    gameTimeLeft--;
    updateGameTimerUI();

    if (gameTimeLeft <= 0) {
      clearInterval(gameTimer);
      handleGameTimeout();
    }
  }, 1000);
}

function updateGameTimerUI() {
  document.getElementById('timer-count').innerText = gameTimeLeft;
  const percent = (gameTimeLeft / GAME_INITIAL_TIME) * 100;
  document.getElementById('timer-progress-fill').style.width = `${percent}%`;
}

function handleGameTimeout() {
  if (autoPronounceTimeout) clearTimeout(autoPronounceTimeout);
  isCurrentQuestionSubmitted = true;
  const q = activeGameList[currentGameIndex];
  addMistake(q.id);
  playSound(q.word);

  // 標記紅色
  renderLetterSlots(q.word, document.getElementById('answer-input').value, true);

  const fb = document.getElementById('game-feedback');
  fb.className = 'feedback-box error';
  fb.innerHTML = `⏰ 時間到！正解：<b>${q.word}</b> (已存入不熟區)`;

  document.getElementById('submit-btn').style.display = 'none';
  document.getElementById('next-question-btn').style.display = 'block';
}

function submitGameAnswer() {
  if (!activeGameList.length || currentGameIndex >= activeGameList.length || isCurrentQuestionSubmitted) return;
  if (autoPronounceTimeout) clearTimeout(autoPronounceTimeout);
  clearInterval(gameTimer);
  isCurrentQuestionSubmitted = true;

  const input = document.getElementById('answer-input');
  const userAns = input.value.trim().toLowerCase();
  const target = activeGameList[currentGameIndex].word.trim().toLowerCase();
  const fb = document.getElementById('game-feedback');

  input.disabled = true;

  // 逐字對比並標記紅/綠色
  renderLetterSlots(target, userAns, true);

  if (userAns === target) {
    gameCorrectCount++;
    const earned = 100 + (gameTimeLeft * 15);
    gameScore += earned;
    document.getElementById('score-display').innerText = `積分：${gameScore}`;
    playSound(target);

    fb.className = 'feedback-box success';
    fb.innerHTML = `🎉 完全正確！+${earned} 積分`;
  } else {
    addMistake(activeGameList[currentGameIndex].id);
    playSound(target);

    fb.className = 'feedback-box error';
    fb.innerHTML = `❌ 拼錯了！正解：<b>${activeGameList[currentGameIndex].word}</b> (已存入不熟區)`;
  }

  // 隱藏送出鍵，顯示「NEXT 下一題」按鈕由孩子點擊
  document.getElementById('submit-btn').style.display = 'none';
  document.getElementById('next-question-btn').style.display = 'block';
}

// 點擊 NEXT 下一題按鈕切換
document.getElementById('next-question-btn').addEventListener('click', () => {
  currentGameIndex++;
  loadGameQuestion();
});

// 即時打字同步更新虛線中的字母
document.getElementById('answer-input').addEventListener('input', (e) => {
  if (!activeGameList.length || currentGameIndex >= activeGameList.length || isCurrentQuestionSubmitted) return;
  const target = activeGameList[currentGameIndex].word;
  renderLetterSlots(target, e.target.value.toLowerCase(), false);
});

// 結算判定（必須達 90% 正確率）
function triggerRoundSummary() {
  clearInterval(gameTimer);
  if (autoPronounceTimeout) clearTimeout(autoPronounceTimeout);
  const modal = document.getElementById('round-summary-modal');
  const acc = Math.round((gameCorrectCount / gameTotalCount) * 100) || 0;

  document.getElementById('summary-total').innerText = gameTotalCount;
  document.getElementById('summary-correct').innerText = gameCorrectCount;
  document.getElementById('summary-score').innerText = gameScore;
  document.getElementById('summary-accuracy').innerText = `${acc}%`;

  const verdict = document.getElementById('summary-verdict');
  const icon = document.getElementById('summary-icon');
  const title = document.getElementById('summary-title');

  if (acc >= 90) {
    icon.innerText = "👑";
    title.innerText = "挑戰通過！你就是單字王";
    verdict.className = "summary-verdict-box verdict-pass";
    verdict.innerText = `🌟 達成 ${acc}% 正確率（標準: 90%）恭喜通過！`;
  } else {
    icon.innerText = "💪";
    title.innerText = "未達 90% 通過門檻";
    verdict.className = "summary-verdict-box verdict-fail";
    verdict.innerText = `⚠️ 正確率 ${acc}%，差一點點！再挑戰一次吧！`;
  }

  modal.style.display = 'flex';
}

document.getElementById('restart-round-btn').addEventListener('click', startNewGameSession);

document.getElementById('game-sound-btn').addEventListener('click', () => {
  if (!activeGameList.length || currentGameIndex >= activeGameList.length) return;
  playSound(activeGameList[currentGameIndex].word);
});

// =================== 模式 2：例句克漏字 ===================
function loadClozeBattleRound() {
  if (!activeClozeList.length) return;
  const q = activeClozeList[currentClozeIndex];

  document.getElementById('cloze-sentence-text').innerHTML = q.sentence.replace('___', '<b style="color:#38bdf8; text-decoration:underline;">______</b>');
  document.getElementById('cloze-round-toast').innerText = '';

  const options = [...q.options].sort(() => Math.random() - 0.5);
  const container = document.getElementById('cloze-options-container');
  container.innerHTML = '';

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerText = opt;
    btn.onclick = () => handleClozeChoice(btn, opt, q.word);
    container.appendChild(btn);
  });

  clozeTimeLeft = CLOZE_INITIAL_TIME;
  startClozeTimer();
}

function startClozeTimer() {
  clearInterval(clozeTimer);
  updateClozeTimerVisual(CLOZE_INITIAL_TIME);

  clozeTimer = setInterval(() => {
    clozeTimeLeft--;
    updateClozeTimerVisual(clozeTimeLeft);

    if (clozeTimeLeft <= 0) {
      clearInterval(clozeTimer);
      handleClozeTimeout();
    }
  }, 1000);
}

function updateClozeTimerVisual(t) {
  document.getElementById('cloze-timer-text').innerText = t;
  const stroke = document.getElementById('cloze-timer-stroke');
  const offset = CIRCLE_CIRCUMFERENCE - (t / CLOZE_INITIAL_TIME) * CIRCLE_CIRCUMFERENCE;
  stroke.style.strokeDashoffset = offset;
  stroke.style.stroke = t <= 3 ? "#ef4444" : "#38bdf8";
}

function handleClozeChoice(selectedBtn, selectedText, answerText) {
  clearInterval(clozeTimer);
  const allBtns = document.querySelectorAll('#cloze-options-container .choice-btn');
  allBtns.forEach(b => b.disabled = true);

  const toast = document.getElementById('cloze-round-toast');
  const isCorrect = selectedText.toLowerCase() === answerText.toLowerCase();

  if (isCorrect) {
    selectedBtn.classList.add('correct');
    playSound(answerText);
    const earned = 100 + (clozeTimeLeft * 15);

    if (clozeBattleMode === 'pve') {
      p1Score += earned;
      toast.innerHTML = `<span style="color:#34d399;">⚡ 玩家1 答對！+${earned} 分</span>`;
    } else {
      if (pvpTurn === 1) {
        p1Score += earned;
        toast.innerHTML = `<span style="color:#38bdf8;">⚡ 玩家1 答對！+${earned} 分</span>`;
      } else {
        p2Score += earned;
        toast.innerHTML = `<span style="color:#fb7185;">⚡ 玩家2 答對！+${earned} 分</span>`;
      }
    }
  } else {
    selectedBtn.classList.add('wrong');
    allBtns.forEach(b => {
      if (b.innerText.toLowerCase() === answerText.toLowerCase()) b.classList.add('correct');
    });
    addMistake(activeClozeList[currentClozeIndex].id);
    playSound(answerText);
    toast.innerHTML = `<span style="color:#f87171;">❌ 答錯！正解為 ${answerText}</span>`;
  }

  if (clozeBattleMode === 'pve') {
    if (Math.random() < 0.65) {
      p2Score += 100 + (Math.floor(Math.random() * 8) * 10);
    }
  }

  updateClozeMeters();

  if (clozeBattleMode === 'pvp') {
    pvpTurn = pvpTurn === 1 ? 2 : 1;
    document.getElementById('turn-indicator-bar').innerText = `當前回合：玩家 ${pvpTurn} 作答`;
  }

  setTimeout(() => {
    currentClozeIndex = (currentClozeIndex + 1) % activeClozeList.length;
    loadClozeBattleRound();
  }, 1600);
}

function handleClozeTimeout() {
  const currentWord = activeClozeList[currentClozeIndex].word;
  addMistake(activeClozeList[currentClozeIndex].id);
  playSound(currentWord);

  const allBtns = document.querySelectorAll('#cloze-options-container .choice-btn');
  allBtns.forEach(b => {
    b.disabled = true;
    if (b.innerText.toLowerCase() === currentWord.toLowerCase()) b.classList.add('correct');
  });

  document.getElementById('cloze-round-toast').innerHTML = `<span style="color:#f87171;">⏰ 時間到！答案是 ${currentWord}</span>`;

  if (clozeBattleMode === 'pve') {
    p2Score += 80;
  } else {
    pvpTurn = pvpTurn === 1 ? 2 : 1;
    document.getElementById('turn-indicator-bar').innerText = `當前回合：玩家 ${pvpTurn} 作答`;
  }

  updateClozeMeters();

  setTimeout(() => {
    currentClozeIndex = (currentClozeIndex + 1) % activeClozeList.length;
    loadClozeBattleRound();
  }, 2000);
}

function updateClozeMeters() {
  document.getElementById('p1-score-text').innerText = p1Score;
  document.getElementById('p2-score-text').innerText = p2Score;
  const p1Pct = Math.min(100, (p1Score / 1000) * 100);
  const p2Pct = Math.min(100, (p2Score / 1000) * 100);
  document.getElementById('p1-meter-fill').style.height = `${p1Pct}%`;
  document.getElementById('p2-meter-fill').style.height = `${p2Pct}%`;
}

function resetClozeScores() {
  p1Score = 0;
  p2Score = 0;
  updateClozeMeters();
}

document.getElementById('cloze-listen-btn').addEventListener('click', () => {
  if (!activeClozeList.length) return;
  const q = activeClozeList[currentClozeIndex];
  playSound(q.sentence.replace('___', q.word));
});

// =================== 模式 3 & 4：不熟區與後台 ===================
function addMistake(id) {
  mistakeIds.add(id);
  localStorage.setItem('mistakes', JSON.stringify([...mistakeIds]));
  updateMistakeBadge();
}

function removeMistake(id) {
  mistakeIds.delete(id);
  localStorage.setItem('mistakes', JSON.stringify([...mistakeIds]));
  renderMistakes();
  updateMistakeBadge();
}

function updateMistakeBadge() {
  document.getElementById('mistake-badge').innerText = mistakeIds.size;
}

function renderMistakes() {
  const list = document.getElementById('mistakes-list');
  list.innerHTML = '';

  if (mistakeIds.size === 0) {
    list.innerHTML = `<p style="text-align:center; color:#94a3b8; margin-top:40px;">太棒了，目前沒有不熟單字！</p>`;
    return;
  }

  const badQuestions = allQuestions.filter(q => mistakeIds.has(q.id));
  badQuestions.forEach(q => {
    const item = document.createElement('div');
    item.className = 'mistake-card';
    item.innerHTML = `
      <div>
        <span class="chapter-tag" style="font-size:0.75rem; padding:2px 6px;">${q.chapter || 'Unit 1'}</span>
        <strong>${q.word}</strong> <span style="color:#6366f1; font-size:0.85rem;">[${q.pos}]</span>
        <div style="color:#64748b; font-size:0.88rem; margin-top:2px;">${q.zh}</div>
      </div>
      <div>
        <button class="btn-sound" onclick="playSound('${q.word}')">🔊</button>
        <button style="border:none; background:#fee2e2; color:#ef4444; padding:6px 10px; border-radius:8px; font-weight:700; cursor:pointer;" onclick="removeMistake(${q.id})">已熟記</button>
      </div>
    `;
    list.appendChild(item);
  });
}

function setupAdminAuth() {
  document.getElementById('admin-login-btn').addEventListener('click', () => {
    const pwd = document.getElementById('admin-pwd-input').value;
    if (pwd === ADMIN_PASSWORD) {
      isAdminAuthenticated = true;
      document.getElementById('admin-pwd-input').value = '';
      document.getElementById('auth-error-msg').style.display = 'none';
      checkAdminDisplay();
    } else {
      document.getElementById('auth-error-msg').style.display = 'block';
    }
  });

  document.getElementById('admin-logout-btn').addEventListener('click', () => {
    isAdminAuthenticated = false;
    checkAdminDisplay();
  });
}

function checkAdminDisplay() {
  document.getElementById('admin-auth-panel').style.display = isAdminAuthenticated ? 'none' : 'block';
  document.getElementById('admin-main-panel').style.display = isAdminAuthenticated ? 'block' : 'none';
  if (isAdminAuthenticated) renderAdminList();
}

function getTargetImportChapter() {
  const customInput = document.getElementById('import-chapter-custom').value.trim();
  if (customInput) return customInput;
  const selectVal = document.getElementById('import-chapter-select').value;
  return selectVal || "Unit 1";
}

// 圖片 OCR 辨識解析
document.getElementById('ocr-image-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const targetChapter = getTargetImportChapter();
  const statusBar = document.getElementById('ocr-status-bar');
  const statusText = document.getElementById('ocr-status-text');
  const progressInner = document.getElementById('ocr-progress-inner');
  const resultContainer = document.getElementById('ocr-result-container');
  const jsonOutput = document.getElementById('ocr-json-output');

  statusBar.style.display = 'block';
  resultContainer.style.display = 'none';

  try {
    const result = await Tesseract.recognize(file, 'chi_tra+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.floor(m.progress * 100);
          statusText.innerText = `正在分析圖片單字中... ${pct}%`;
          progressInner.style.width = `${pct}%`;
        }
      }
    });

    statusText.innerText = "文字辨識完成，正在智慧建立題目結構...";
    const parsedData = parseOcrTextToQuiz(result.data.text, targetChapter);

    jsonOutput.value = JSON.stringify(parsedData, null, 2);
    document.getElementById('pending-chapter-badge').innerText = `目標章節: ${targetChapter}`;
    resultContainer.style.display = 'block';
    statusBar.style.display = 'none';

    alert(`🎉 辨識完成！已自動將題目設定為【${targetChapter}】，請校對後點擊「確認套用設定並匯入」。`);
  } catch (err) {
    console.error("圖片辨識失敗：", err);
    alert("圖片解析失敗，請確認圖片清晰度。");
    statusBar.style.display = 'none';
  }
});

function parseOcrTextToQuiz(rawText, chapterName) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items = [];
  const posRegex = /(n\.|v\.|adj\.|adv\.|phr\.|prep\.)/i;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const posMatch = line.match(posRegex);
    if (posMatch) {
      const pos = posMatch[0].toLowerCase();
      const parts = line.split(posMatch[0]);
      let word = parts[0].replace(/^[0-9\s\.\-]+/, '').replace(/\[.*?\]/, '').trim();
      let zh = parts[1] ? parts[1].replace(/^[0-9\s\.\-]+/, '').trim() : "常用字彙";
      
      if (word.length >= 2 && /^[a-zA-Z\s\-]+$/.test(word)) {
        let sentence = "";
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          if (lines[j].includes(word) || lines[j].endsWith('.')) {
            sentence = lines[j];
            break;
          }
        }
        if (!sentence) {
          sentence = `It is crucial to understand the concept of ___ in daily life.`;
        } else {
          sentence = sentence.replace(new RegExp(word, 'gi'), '___');
        }

        items.push({
          id: Date.now() + Math.floor(Math.random() * 10000),
          chapter: chapterName,
          word: word.toLowerCase(),
          pos: pos,
          zh: zh || "核心單字",
          level: 1,
          sentence: sentence,
          options: [word.toLowerCase(), "finance", "rebel", "prime"]
        });
      }
    }
  }
  return items;
}

// JSON 檔案直接匯入
document.getElementById('json-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const targetChapter = getTargetImportChapter();
  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      let data = JSON.parse(event.target.result);
      if (!Array.isArray(data)) {
        alert("JSON 格式必須為陣列（Array）！");
        return;
      }
      data = data.map(item => ({
        ...item,
        id: item.id || (Date.now() + Math.floor(Math.random() * 10000)),
        chapter: targetChapter
      }));

      document.getElementById('ocr-json-output').value = JSON.stringify(data, null, 2);
      document.getElementById('pending-chapter-badge').innerText = `目標章節: ${targetChapter}`;
      document.getElementById('ocr-result-container').style.display = 'block';

      alert(`📂 已載入 ${data.length} 題，章節已統一配置為【${targetChapter}】，確認後請點擊匯入！`);
    } catch (err) {
      alert("讀取 .json 檔案失敗，請確認檔案格式是否正確。");
    }
  };
  reader.readAsText(file);
});

// 確認匯入題庫
document.getElementById('confirm-import-btn').addEventListener('click', () => {
  try {
    const jsonStr = document.getElementById('ocr-json-output').value;
    let newItems = JSON.parse(jsonStr);

    if (!Array.isArray(newItems) || newItems.length === 0) {
      alert("題目內容為空！");
      return;
    }

    const finalChapter = getTargetImportChapter();
    newItems = newItems.map(q => ({
      ...q,
      chapter: q.chapter || finalChapter
    }));

    customQuestions = [...customQuestions, ...newItems];
    localStorage.setItem('custom_questions', JSON.stringify(customQuestions));
    
    refreshTotalQuestions();
    renderAdminList();

    alert(`✅ 成功匯入 ${newItems.length} 個單字至【${finalChapter}】章節！`);
    document.getElementById('ocr-result-container').style.display = 'none';
    document.getElementById('import-chapter-custom').value = '';
    document.getElementById('ocr-image-input').value = '';
    document.getElementById('json-file-input').value = '';
  } catch (err) {
    alert("JSON 語法錯誤，請確認格式。");
  }
});

document.getElementById('download-parsed-json-btn').addEventListener('click', () => {
  const jsonStr = document.getElementById('ocr-json-output').value;
  const targetChapter = getTargetImportChapter();
  const dl = document.createElement('a');
  dl.setAttribute("href", "data:text/json;charset=utf-8," + encodeURIComponent(jsonStr));
  dl.setAttribute("download", `${targetChapter}_題庫_${Date.now()}.json`);
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
});

// 單筆手動新增
document.getElementById('add-word-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const chapter = document.getElementById('new-chapter').value.trim();
  const word = document.getElementById('new-word').value.trim();
  const pos = document.getElementById('new-pos').value.trim();
  const zh = document.getElementById('new-zh').value.trim();
  let sentence = document.getElementById('new-sentence').value.trim();
  const opt2 = document.getElementById('new-opt2').value.trim();
  const opt3 = document.getElementById('new-opt3').value.trim();
  const opt4 = document.getElementById('new-opt4').value.trim();

  if (!sentence.includes('___')) sentence = sentence.replace(new RegExp(word, 'gi'), '___');

  customQuestions.push({
    id: Date.now(),
    chapter: chapter || "Unit 1",
    word,
    pos,
    zh,
    sentence,
    options: [word, opt2, opt3, opt4]
  });

  localStorage.setItem('custom_questions', JSON.stringify(customQuestions));
  refreshTotalQuestions();
  renderAdminList();
  e.target.reset();
  alert(`單字 "${word}" 已成功加入【${chapter}】！`);
});

function renderAdminList() {
  const container = document.getElementById('admin-word-list');
  container.innerHTML = '';
  allQuestions.forEach(q => {
    const isCustom = customQuestions.some(c => c.id === q.id);
    const div = document.createElement('div');
    div.className = 'admin-item-card';
    div.innerHTML = `
      <div>
        <strong style="color:#0f172a;">${q.word}</strong> <small style="color:#64748b;">[${q.chapter || 'Unit 1'}] ${q.zh}</small>
      </div>
      <div>
        ${isCustom ? `<button style="border:none; background:#fee2e2; color:#ef4444; border-radius:6px; padding:4px 8px; cursor:pointer;" onclick="deleteCustomWord(${q.id})">刪除</button>` : '<span style="font-size:0.75rem; color:#94a3b8;">預設</span>'}
      </div>
    `;
    container.appendChild(div);
  });
}

function deleteCustomWord(id) {
  if (confirm("確定刪除此單字？")) {
    customQuestions = customQuestions.filter(c => c.id !== id);
    localStorage.setItem('custom_questions', JSON.stringify(customQuestions));
    refreshTotalQuestions();
    renderAdminList();
  }
}

document.getElementById('export-json-btn').addEventListener('click', () => {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allQuestions, null, 2));
  const dl = document.createElement('a');
  dl.setAttribute("href", dataStr);
  dl.setAttribute("download", "questions.json");
  document.body.appendChild(dl);
  dl.click();
  dl.remove();
});

// 事件綁定
document.getElementById('submit-btn').addEventListener('click', submitGameAnswer);
document.getElementById('answer-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    if (!isCurrentQuestionSubmitted) {
      submitGameAnswer();
    } else {
      // 已經送出後，按 Enter 也能等同點擊 NEXT
      document.getElementById('next-question-btn').click();
    }
  }
});

document.getElementById('clear-mistakes-btn').addEventListener('click', () => {
  mistakeIds.clear();
  localStorage.removeItem('mistakes');
  renderMistakes();
  updateMistakeBadge();
});

initApp();